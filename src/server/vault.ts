import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { emit } from "../core/events.ts";
import {
	parseLibrarySettings, parseVaultExclude, reconcileVault, vaultPathExcluded,
	type LibrarySettings, type VaultFile, type VaultReconcile,
} from "../core/vault-sync.ts";
import { VAULT_DIR, VAULT_EXCLUDE_RAW } from "./vault-config.ts";
import { sourceDirectory } from "./source-organization.ts";
import { stores } from "./stores.ts";

/** Largest vault note the library scans or reads (2 MiB). */
export const MAX_VAULT_NOTE_BYTES = 2 * 1024 * 1024;

/** The note content hash. The scanner and the extractor must agree, or
 *  every note re-extracts on the next scan. */
export function hashVaultNote(bytes: Buffer | string): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/** The saved `library` section of the settings record, validated (the
 *  record keeps unknown sections verbatim, so its shape is checked here). */
export function readLibrarySettings(): LibrarySettings | undefined {
	const raw = stores.settingsStore.readSettings()?.library;
	if (raw === undefined) return undefined;
	const parsed = parseLibrarySettings(raw);
	return parsed.ok ? parsed.settings : undefined;
}

/** Saved library settings win; LH_VAULT_EXCLUDE seeds the skip list until
 * the learner saves one. Auto-extract is off until switched on. */
export function libraryPreferences(): { autoExtract: boolean; exclude: string[] } {
	const library = readLibrarySettings();
	return {
		autoExtract: library?.autoExtract ?? false,
		exclude: library?.exclude ?? parseVaultExclude(VAULT_EXCLUDE_RAW),
	};
}

/**
 * The vault follower: scans LH_VAULT_DIR for Markdown notes and reconciles
 * source records — no upload, no import button. The vault is mounted
 * read-only; nothing here ever writes inside it.
 *
 * Polling, not fs.watch: a sync tool replaces files by rename, recursive
 * watches drop events across bind mounts, and hashing a study vault every
 * 30 s costs milliseconds. The scan reads asynchronously; the reconcile and
 * its writes run in one synchronous stretch so no extraction write
 * interleaves between reading and writing the source map.
 */
/** Content hashes from earlier scans, keyed by vault-relative path. A note
 *  whose size, mtime and inode are unchanged keeps its hash without being
 *  read again; entries not seen in a scan are pruned, so the map stays
 *  bounded by the vault. */
const hashCache = new Map<string, { size: number; mtimeMs: number; ino: number; hash: string }>();

async function walk(root: string, dir: string, exclude: readonly string[], out: VaultFile[]): Promise<void> {
	let entries: fs.Dirent[];
	try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
	catch (err) { if ((err as NodeJS.ErrnoException).code === "ENOENT") return; throw err; }
	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		const full = path.join(dir, entry.name);
		const rel = path.relative(root, full).split(path.sep).join("/");
		if (entry.isDirectory()) {
			if (!vaultPathExcluded(`${rel}/`, exclude)) await walk(root, full, exclude, out);
		} else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md") && !vaultPathExcluded(rel, exclude)) {
			let hash: string;
			// Unchanged note: one lstat (never follows a symlink) and the cached
			// hash. Anything else takes the descriptor path below.
			const known = hashCache.get(rel);
			if (known) {
				try {
					const st = await fs.promises.lstat(full);
					if (st.isFile() && st.size === known.size && st.mtimeMs === known.mtimeMs && st.ino === known.ino) {
						out.push({ path: rel, hash: known.hash });
						continue;
					}
				} catch { /* gone or unreadable: the open below decides */ }
			}
			// A file deleted between readdir and read is simply absent this scan.
			// A note over the size cap stays present (never missing), but is not
			// read: its size and mtime stand in for the content hash, so an edit
			// still marks it changed, and extraction refuses it.
			// Stat and read the opened descriptor: an entry swapped for a
			// symlink after readdir is refused (O_NOFOLLOW), and a FIFO cannot
			// block the scan (O_NONBLOCK, then the regular-file check).
			try {
				const handle = await fs.promises.open(full, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
				try {
					const stat = await handle.stat();
					if (!stat.isFile()) continue;
					hash = hashVaultNote(stat.size > MAX_VAULT_NOTE_BYTES
						? `oversize:${stat.size}:${stat.mtimeMs}`
						: await handle.readFile());
					hashCache.set(rel, { size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino, hash });
				} finally { await handle.close(); }
			} catch { continue; }
			out.push({ path: rel, hash });
		}
	}
}

let scanning: Promise<VaultReconcile | null> | null = null;
let rescan = false;

/** The walk never enters skipped paths, so stat each followed skip-listed
 * note to tell "on the skip list" from "gone". Runs before the synchronous
 * reconcile stretch; a source minted meanwhile is checked on the next scan. */
async function goneSkippedNotes(root: string, exclude: readonly string[]): Promise<Set<string>> {
	const gone = new Set<string>();
	for (const source of stores.graphStore.readSources()) {
		const rel = source.vault?.path;
		if (!rel || !vaultPathExcluded(rel, exclude)) continue;
		try { await fs.promises.lstat(path.join(root, rel)); }
		catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code === "ENOENT" || code === "ENOTDIR") gone.add(rel);
		}
	}
	return gone;
}

async function scanOnce(root: string): Promise<VaultReconcile | null> {
	try {
		await fs.promises.access(root, fs.constants.R_OK);
		const exclude = libraryPreferences().exclude;
		const files: VaultFile[] = [];
		await walk(root, root, exclude, files);
		const seen = new Set(files.map((file) => file.path));
		for (const rel of hashCache.keys()) if (!seen.has(rel)) hashCache.delete(rel);
		files.sort((a, b) => a.path.localeCompare(b.path));
		const absent = await goneSkippedNotes(root, exclude);
		// Read again after the awaits above: from here to the write is one
		// synchronous stretch, so no extraction write can slip in between.
		const before = new Map(stores.graphStore.readSources().map((s) => [s.id, s]));
		const result = reconcileVault([...before.values()], files, new Date().toISOString(),
			() => `src_${randomBytes(6).toString("hex")}`, exclude, absent);
		stores.graphStore.upsertSources(result.upserts);
		if (result.upserts.length > 0) {
			console.info(`[vault] ${result.created} new, ${result.renamed} moved, ${result.changed} edited, ${result.missing} missing, ${result.restored} back`);
			// New notes get folders mirroring the vault; moved notes follow.
			const placements = result.upserts
				.map((s) => ({ id: s.id, filePath: s.filePath, previousPath: before.get(s.id)?.vault?.path }))
				.filter((note) => note.previousPath !== note.filePath);
			try { sourceDirectory.placeVaultSources(placements); }
			catch (err) { console.error("[vault] could not place notes in source folders", err); }
			emit("sources-changed", {});
		}
		return result;
	} catch (err) {
		console.error("[vault] scan failed", err);
		return null;
	}
}

/** One scan + reconcile. Concurrent callers share the in-flight scan, and
 * a call arriving mid-scan queues exactly one more — a skip list saved
 * while an old-list scan runs still applies now, not a poll later. An
 * unreadable vault root (unmounted, permissions) skips the reconcile rather
 * than marking every note missing. */
export function syncVault(): Promise<VaultReconcile | null> {
	const root = VAULT_DIR;
	if (!root) return Promise.resolve(null);
	if (scanning) { rescan = true; return scanning; }
	scanning = (async () => {
		try {
			let result = await scanOnce(root);
			while (rescan) { rescan = false; result = await scanOnce(root); }
			return result;
		} finally {
			scanning = null;
		}
	})();
	return scanning;
}
