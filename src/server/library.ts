import fs from "node:fs";
import path from "node:path";
import type { NotesSource } from "../core/contracts.ts";
import { emit } from "../core/events.ts";
import { getGraph } from "../core/graph.ts";
import { detachSourceTraces, pruneDetachedNodes } from "../core/graph-deletion.ts";
import { ModelsNotConfiguredError, ProviderKeyMissingError } from "../core/settings.ts";
import { vaultEntryState, type LibraryStatus, type MissingVaultNote } from "../core/vault-sync.ts";
import { extraction } from "./chat-handler.ts";
import { deleteSources, SourceDeletionError } from "./source-deletion.ts";
import { stores } from "./stores.ts";
import { hashVaultNote, libraryPreferences, MAX_VAULT_NOTE_BYTES, readLibrarySettings, syncVault } from "./vault.ts";
import { VAULT_DIR } from "./vault-config.ts";

/**
 * The vault library's extraction side. Notes whose bytes differ from what
 * the graph reflects are WAITING; Sync now drains them all, auto-extract
 * (off by default) drains only notes quiet for five minutes — an editor
 * saves while typing and a sync tool pushes every save, so a note mid-edit
 * must not burn a run per keystroke burst.
 *
 * One drain at a time, notes in sequence: the pipeline already caps model
 * concurrency, and serializing keeps the detach → re-extract → prune
 * stretch of one note from interleaving with another note's.
 */
const QUIET_MS = 5 * 60_000;
const POLL_MS = 30_000;

const followed = (): NotesSource[] => stores.graphStore.readSources().filter((s) => s.vault);
const vaultNoteWaiting = (s: NotesSource): boolean =>
	!!s.vault && !s.vault.missingSince && s.vault.contentHash !== s.vault.extractedHash;

let draining: Promise<void> | null = null;
/** A Sync now that arrives while an auto drain runs widens that drain to
 *  notes still inside their quiet period (it re-checks on every pick). */
let manualRequested = false;
let blocked: string | null = null;
let extracting: NotesSource | null = null;
const isSetupRefusal = (err: unknown): boolean =>
	err instanceof ModelsNotConfiguredError || err instanceof ProviderKeyMissingError;

export function libraryStatus(): LibraryStatus {
	const sources = followed();
	const { autoExtract, exclude } = libraryPreferences();
	const states = sources.map((s) => vaultEntryState(s, s.id === extracting?.id, exclude));
	return {
		enabled: VAULT_DIR !== null,
		autoExtract,
		exclude,
		saved: readLibrarySettings() ?? {},
		notes: sources.filter((s) => !s.vault!.missingSince).length,
		waiting: sources.filter(vaultNoteWaiting).length,
		missing: states.filter((state) => state === "missing").length,
		skipped: states.filter((state) => state === "skipped").length,
		extracting: extracting?.vault?.path ?? null,
		draining: draining !== null,
		blocked,
	};
}

/** Followed notes gone from the vault (not merely skipped), with their
 * graph impact. One pass over the merged graph: distinct source ids on a
 * node are its backing sources; a single one means the idea is its alone. */
export function missingVaultNotes(): MissingVaultNote[] {
	const { exclude } = libraryPreferences();
	const missing = followed().filter((s) => vaultEntryState(s, false, exclude) === "missing");
	if (missing.length === 0) return [];
	const ideas = new Map<string, number>();
	const only = new Map<string, number>();
	// Ideas a failed re-extraction left detached (no provenance, listed only
	// in vault.detached) are pruned by the deletion too, so they count.
	const orphaned = new Set<string>();
	for (const node of getGraph(stores.graphStore).nodes) {
		if (node.provenance.length === 0) orphaned.add(node.id);
		const distinct = new Set(node.provenance.map((p) => p.chatId));
		for (const id of distinct) ideas.set(id, (ideas.get(id) ?? 0) + 1);
		if (distinct.size === 1) for (const id of distinct) only.set(id, (only.get(id) ?? 0) + 1);
	}
	return missing
		.map((s) => {
			const detached = [...new Set(s.vault!.detached ?? [])].filter((id) => orphaned.has(id)).length;
			return {
				id: s.id, path: s.vault!.path, missingSince: s.vault!.missingSince!,
				ideas: (ideas.get(s.id) ?? 0) + detached, onlyFromThisNote: (only.get(s.id) ?? 0) + detached,
			};
		})
		.sort((a, b) => a.path.localeCompare(b.path));
}

/** Delete missing notes the learner reviewed: their records, placements and
 * the ideas only they supported (the regular source deletion). A fresh scan
 * runs first, so a note restored since the last poll is not deleted. Every
 * id must still be missing — a note that came back, or one only skipped, is
 * refused rather than silently removed. */
export async function deleteMissingVaultNotes(ids: readonly string[]): Promise<MissingVaultNote[]> {
	if (await syncVault() === null) throw new SourceDeletionError("Could not scan the vault. Check that it is mounted and readable, then try again.", 503, "vault_scan_failed");
	const missing = new Set(missingVaultNotes().map((note) => note.id));
	const stale = ids.filter((id) => !missing.has(id));
	if (stale.length) throw new SourceDeletionError("Some notes are no longer missing from the vault. Refresh and review again.", 409, "vault_note_not_missing");
	deleteSources({ sourceIds: [...ids], folderIds: [], deleteSessions: false });
	return missingVaultNotes();
}

/** Write vault state onto the FRESH record (a scan may have moved the file
 * while the run was in flight); a source deleted meanwhile stays deleted. */
function patchVault(id: string, patch: (vault: NonNullable<NotesSource["vault"]>) => NotesSource["vault"]): void {
	const fresh = stores.graphStore.readSources().find((s) => s.id === id);
	if (fresh?.vault) stores.graphStore.upsertSource({ ...fresh, vault: patch(fresh.vault) });
}

const OVERSIZE_ERROR = `Note is larger than ${MAX_VAULT_NOTE_BYTES / (1024 * 1024)} MiB; not extracted.`;

/** Read a vault note without following a final symlink: it must be a regular
 *  file under the size cap whose real path stays inside the vault root. */
async function readVaultNote(root: string, relative: string): Promise<Buffer> {
	const full = path.join(root, relative);
	let handle: fs.promises.FileHandle;
	try { handle = await fs.promises.open(full, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
	catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ELOOP") throw new Error("Vault note is a symlink; the library reads regular files only.");
		throw err;
	}
	try {
		const stat = await handle.stat();
		if (!stat.isFile()) throw new Error("Vault note is not a regular file.");
		if (stat.size > MAX_VAULT_NOTE_BYTES) throw new Error(OVERSIZE_ERROR);
		const [realRoot, realFile] = await Promise.all([fs.promises.realpath(root), fs.promises.realpath(full)]);
		const rel = path.relative(realRoot, realFile);
		if (rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error("Vault note resolves outside the vault folder.");
		const bytes = await handle.readFile();
		if (bytes.length > MAX_VAULT_NOTE_BYTES) throw new Error(OVERSIZE_ERROR);
		return bytes;
	} finally {
		await handle.close();
	}
}

async function extractNote(root: string, source: NotesSource): Promise<void> {
	const vault = source.vault!;
	let bytes: Buffer;
	try { bytes = await readVaultNote(root, vault.path); }
	catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return; // gone since the scan — the next scan marks it missing
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[library] ${vault.path}: extraction failed: ${message}`);
		patchVault(source.id, (v) => ({ ...v, lastError: message }));
		emit("sources-changed", {});
		return;
	}
	const hash = hashVaultNote(bytes);
	// Refuse BEFORE detaching: a run that cannot start must leave the note's
	// chains and coverage exactly as they were.
	extraction.assertReady();
	extracting = source;
	emit("sources-changed", {});
	try {
		// Detach is idempotent and also covers a first run that merged some
		// chunks before failing; earlier unpruned candidates carry over.
		const detached = new Set([...(vault.detached ?? []), ...detachSourceTraces(stores.graphStore, source.id)]);
		patchVault(source.id, (v) => ({ ...v, detached: [...detached] }));
		await extraction.extractVaultNote({ id: source.id, filePath: vault.path, text: bytes.toString("utf-8") });
		const pruned = pruneDetachedNodes(stores.graphStore, detached);
		if (pruned > 0) console.info(`[library] ${vault.path}: pruned ${pruned} idea(s) the note no longer supports`);
		patchVault(source.id, (v) => {
			const { detached: _done, lastError: _cleared, ...rest } = v;
			return { ...rest, extractedHash: hash };
		});
	} catch (err) {
		if (isSetupRefusal(err)) throw err; // a setup problem, not this note's
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[library] ${vault.path}: extraction failed: ${message}`);
		patchVault(source.id, (v) => ({ ...v, lastError: message }));
	} finally {
		extracting = null;
		emit("sources-changed", {});
	}
}

/** Drain waiting notes. "manual" ignores the quiet period and retries
 * failed notes; "auto" takes quiet notes that have not failed on their
 * current bytes (a failure would otherwise re-run, and bill, every poll).
 * A setup refusal stops the drain and is reported once via `blocked`. */
export function drainLibrary(mode: "manual" | "auto"): Promise<void> {
	const root = VAULT_DIR;
	if (!root) return Promise.resolve();
	if (mode === "manual") manualRequested = true;
	draining ??= (async () => {
		try {
			await syncVault();
			const tried = new Set<string>();
			for (;;) {
				const now = Date.now();
				const next = followed().find((s) => vaultNoteWaiting(s) && !tried.has(s.id)
					&& (manualRequested || (!s.vault!.lastError && now - Date.parse(s.vault!.changedAt) >= QUIET_MS)));
				if (!next) return;
				tried.add(next.id); // one attempt per note per drain: a failure must not spin
				try {
					await extractNote(root, next);
					blocked = null;
				} catch (err) {
					if (!isSetupRefusal(err)) throw err;
					blocked = (err as Error).message;
					console.info(`[library] sync stopped: ${blocked}`);
					return;
				}
			}
		} finally {
			draining = null;
			manualRequested = false;
			emit("sources-changed", {});
		}
	})();
	return draining;
}

let followerStarted = false;

/** Boot hook (instrumentation.ts): an immediate scan, then a light poll;
 * auto-extract rides the poll when switched on. No-op without LH_VAULT_DIR;
 * a second call is a no-op too. */
export function startVaultFollower(): void {
	if (!VAULT_DIR || followerStarted) return;
	followerStarted = true;
	console.info("[vault] following the configured vault folder");
	// A failed scan or drain must log, not reject unhandled.
	const tick = async () => {
		try {
			await syncVault();
			if (libraryPreferences().autoExtract) await drainLibrary("auto");
		} catch (err) {
			console.error("[vault] follower tick failed:", err);
		}
	};
	void tick();
	setInterval(() => { void tick(); }, POLL_MS).unref();
}
