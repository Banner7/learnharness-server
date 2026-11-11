import type { NotesSource } from "./contracts.ts";

/**
 * Vault library reconcile: the vault is the library and LearnHarness
 * follows it — no import step. Pure: the server scans the directory and
 * hands the file list in; this decides which source records change.
 *
 * Identity: a vault source's id is opaque and minted once, so a rename keeps
 * its graph. A file at a path no source follows is matched to a vanished
 * source with byte-identical content (a rename or move) before a new source
 * is minted. A followed file that vanished is marked missing, never deleted:
 * a sync accident must not wipe ideas without the learner confirming.
 * Sources without `vault` (uploads, chats) are never touched.
 */
export interface VaultFile {
	/** Vault-relative POSIX path. */
	path: string;
	/** sha256 hex of the file bytes. */
	hash: string;
}

export interface VaultReconcile {
	/** Records to write (new, renamed, edited, gone or returned). */
	upserts: NotesSource[];
	created: number;
	renamed: number;
	changed: number;
	missing: number;
	restored: number;
}

export function reconcileVault(
	sources: readonly NotesSource[],
	files: readonly VaultFile[],
	now: string,
	newId: () => string,
	exclude: readonly string[] = [],
	/** Skip-listed followed paths the scanner confirmed are gone from disk. */
	absent: ReadonlySet<string> = new Set(),
): VaultReconcile {
	const result: VaultReconcile = { upserts: [], created: 0, renamed: 0, changed: 0, missing: 0, restored: 0 };
	const followed = sources.filter((s) => s.vault);
	const byPath = new Map(followed.map((s) => [s.vault!.path, s]));
	const present = new Set(files.map((f) => f.path));
	// Rename candidates: followed sources whose path no longer exists. A
	// skipped note is absent from `files` only because the scanner leaves it
	// out — while it is still on disk it is never a move source: a new file
	// with the same bytes must not take over its id and graph.
	const vanished = followed.filter((s) => !present.has(s.vault!.path));
	const movable = vanished.filter((s) => !vaultPathExcluded(s.vault!.path, exclude) || absent.has(s.vault!.path));
	const claimed = new Set<string>();
	const unmatched: VaultFile[] = [];

	for (const file of files) {
		const source = byPath.get(file.path);
		if (!source) { unmatched.push(file); continue; }
		const vault = source.vault!;
		if (vault.contentHash === file.hash && !vault.missingSince) continue;
		const next = { ...vault };
		if (vault.missingSince) { delete next.missingSince; delete next.absent; result.restored++; }
		if (vault.contentHash !== file.hash) {
			next.contentHash = file.hash;
			next.changedAt = now;
			delete next.lastError; // new bytes deserve a fresh attempt
			result.changed++;
		}
		result.upserts.push({ ...source, vault: next });
	}

	for (const file of unmatched) {
		// Only an unambiguous byte-identical match counts as a move; two
		// vanished copies of the same text leave the file a new source.
		const matches = movable.filter((s) => !claimed.has(s.id) && s.vault!.contentHash === file.hash);
		if (matches.length === 1) {
			const source = matches[0]!;
			claimed.add(source.id);
			const next = { ...source.vault!, path: file.path };
			delete next.missingSince;
			delete next.absent;
			result.upserts.push({ ...source, filePath: file.path, vault: next });
			result.renamed++;
			continue;
		}
		result.upserts.push({
			id: newId(),
			filePath: file.path,
			importedAt: now,
			vault: { path: file.path, contentHash: file.hash, changedAt: now },
		});
		result.created++;
	}

	for (const source of vanished) {
		if (claimed.has(source.id)) continue;
		const vault = source.vault!;
		const gone = absent.has(vault.path);
		if (vault.missingSince && !!vault.absent === gone) continue;
		const next = { ...vault, missingSince: vault.missingSince ?? now };
		if (gone) next.absent = true; else delete next.absent;
		result.upserts.push({ ...source, vault: next });
		if (!vault.missingSince) result.missing++;
	}
	return result;
}

/** Exclusion: a pattern ending in "/" excludes that folder and everything
 * under it, matched from the vault root; otherwise it excludes one exact
 * vault-relative path. Dot entries (.obsidian, .trash, sync-tool folders)
 * are always excluded by the scanner.
 *
 * A pattern containing `*` or `?` is a glob: `*` and `?` stay inside one
 * path segment, `**` crosses folders (`**` + `/` also matches zero folders).
 * Plain lines keep their exact meaning: `**` + `/Templates/` skips Templates
 * at any depth, `*.excalidraw.md` only at the root. */
export function vaultPathExcluded(path: string, exclude: readonly string[]): boolean {
	return exclude.some((pattern) => {
		if (!/[*?]/.test(pattern)) return pattern.endsWith("/") ? path.startsWith(pattern) : path === pattern;
		return globRegex(pattern).test(path);
	});
}

const globCache = new Map<string, RegExp>();
function globRegex(pattern: string): RegExp {
	let re = globCache.get(pattern);
	if (re) return re;
	const folder = pattern.endsWith("/");
	const body = folder ? pattern.slice(0, -1) : pattern;
	let src = "";
	for (let i = 0; i < body.length; i++) {
		const c = body[i]!;
		if (c === "*" && body[i + 1] === "*") {
			if (body[i + 2] === "/") { src += "(?:.*/)?"; i += 2; } else { src += ".*"; i += 1; }
		} else if (c === "*") src += "[^/]*";
		else if (c === "?") src += "[^/]";
		else src += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	}
	// A folder glob matches that folder's path as a prefix (everything under
	// it); a file glob must match the whole path.
	re = new RegExp(folder ? `^${src}/` : `^${src}$`);
	globCache.set(pattern, re);
	return re;
}

/** LH_VAULT_EXCLUDE: comma-separated patterns, whitespace-trimmed, empties dropped. */
export function parseVaultExclude(raw: string | undefined): string[] {
	return (raw ?? "").split(",").map((p) => p.trim().replace(/^\/+/, "")).filter(Boolean);
}

/** ready: the graph reflects the file · waiting: new or edited, not yet
 *  extracted · extracting: running now · failed: the last run failed (still
 *  waiting; Sync now retries it) · missing: gone from the vault · skipped:
 *  still on disk but on the skip list (derived from the live list, so
 *  removing a pattern restores the note exactly like a note coming back;
 *  a skip-listed note the scanner found gone, `absent`, is missing). */
export type VaultEntryState = "ready" | "waiting" | "extracting" | "failed" | "missing" | "skipped";

export function vaultEntryState(source: NotesSource, extracting: boolean, exclude: readonly string[] = []): VaultEntryState {
	const vault = source.vault!;
	if (vault.missingSince) return vaultPathExcluded(vault.path, exclude) && !vault.absent ? "skipped" : "missing";
	if (extracting) return "extracting";
	if (vault.contentHash === vault.extractedHash) return "ready";
	return vault.lastError ? "failed" : "waiting";
}

/** The `library` settings record section. Only meaningful when the server
 *  runs with LH_VAULT_DIR. `autoExtract` is off by default: the learner
 *  presses Sync now until they trust unattended spend. `exclude` replaces
 *  the server's LH_VAULT_EXCLUDE seed once saved. */
export interface LibrarySettings {
	autoExtract?: boolean;
	exclude?: string[];
}

/** Replace-whole body for PUT /api/library/settings: patterns are
 *  vault-relative, at most 200, each at most 300 characters, and never
 *  climb out of the vault. */
export function parseLibrarySettings(body: unknown): { ok: true; settings: LibrarySettings } | { ok: false; error: string } {
	if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid JSON body" };
	const raw = body as Record<string, unknown>;
	const settings: LibrarySettings = {};
	if (raw.autoExtract !== undefined) {
		if (typeof raw.autoExtract !== "boolean") return { ok: false, error: "autoExtract must be a boolean" };
		settings.autoExtract = raw.autoExtract;
	}
	if (raw.exclude !== undefined) {
		if (!Array.isArray(raw.exclude) || raw.exclude.length > 200 || !raw.exclude.every((p) => typeof p === "string" && p.length <= 300)) {
			return { ok: false, error: "exclude must be a list of at most 200 short paths" };
		}
		const exclude = (raw.exclude as string[]).map((p) => p.trim().replace(/^\/+/, "")).filter(Boolean);
		if (exclude.some((p) => p.split("/").includes(".."))) return { ok: false, error: "exclude paths must stay inside the vault" };
		settings.exclude = exclude;
	}
	return { ok: true, settings };
}

/** GET /api/library. */
export interface LibraryStatus {
	enabled: boolean;
	autoExtract: boolean;
	/** The effective skip list (saved, else the server's seed). */
	exclude: string[];
	/** The saved `library` section as stored ({} before the first save):
	 *  clients write it back with one field changed, so an unsaved skip list
	 *  stays absent and the server's seed keeps applying. */
	saved: LibrarySettings;
	notes: number;
	waiting: number;
	missing: number;
	skipped: number;
	/** The vault path extracting now, else null. */
	extracting: string | null;
	draining: boolean;
	/** Why the last drain stopped before extracting anything (models or a
	 *  provider key missing); cleared by the next drain that gets going. */
	blocked: string | null;
}

/** GET /api/library/missing: one note gone from the vault, with its impact
 *  on the graph — ideas whose provenance includes it, and of those, ideas
 *  ONLY this note supports (deleting it removes exactly those). */
export interface MissingVaultNote {
	id: string;
	path: string;
	missingSince: string;
	ideas: number;
	onlyFromThisNote: number;
}
