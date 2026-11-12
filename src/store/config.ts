/**
 * The ConfigStore adapter (config wave, v0.2.0): the operator config file at
 * config.CONFIG_FILE (schema: src/core/server-config.ts). The file is managed
 * on the server host; the app only reads it. Every access stats the file and
 * re-parses it only when its identity changed, so edits take effect without
 * a restart. In Docker, mount the file's directory, not the file: a
 * single-file bind mount keeps the old inode after a rename-style save. Reads never throw: a missing file is an empty config; an invalid
 * one is logged once per distinct content, treated as empty as a whole, and
 * its error is reported to the Providers page.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import { CONFIG_FILE } from "../../config.ts";
import type { ConfigStore } from "../core/ports.ts";
import { EMPTY_SERVER_CONFIG, parseServerConfig, registerServerConfigSource, type LoadedServerConfig } from "../core/server-config.ts";

let cached: LoadedServerConfig | undefined;
const logged = new Set<string>();

/** The file's identity for change detection; "" when it is absent. */
function fileStamp(): string {
	try {
		const st = fs.statSync(CONFIG_FILE);
		return `${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`;
	} catch {
		return "";
	}
}

function load(stamp: string): LoadedServerConfig {
	let text: string;
	try {
		text = fs.readFileSync(CONFIG_FILE, "utf-8");
	} catch (err) {
		const code = err && typeof err === "object" && "code" in err ? String(err.code) : "error";
		if (code === "ENOENT") return { config: EMPTY_SERVER_CONFIG, stamp };
		return invalid(stamp, `cannot be read (${code})`, stamp);
	}
	try {
		return { config: parseServerConfig(text), stamp };
	} catch (err) {
		const digest = createHash("sha256").update(text).digest("hex");
		return invalid(stamp, err instanceof Error ? err.message : String(err), digest);
	}
}

function invalid(stamp: string, error: string, logKey: string): LoadedServerConfig {
	if (!logged.has(logKey)) {
		logged.add(logKey);
		console.error(`[config] ${CONFIG_FILE}: ${error}. The whole file is ignored until it is fixed.`);
	}
	return { config: EMPTY_SERVER_CONFIG, error, stamp };
}

export const configStore: ConfigStore = {
	read() {
		// Accept a load only if the file kept the same identity across it, so
		// an in-place writer caught mid-write is read again (up to 3 tries);
		// a partial file never parses anyway, so the worst case is "invalid".
		for (let attempt = 0; attempt < 3; attempt++) {
			const stamp = fileStamp();
			if (cached?.stamp === stamp) return cached;
			const loaded = load(stamp);
			if (fileStamp() === stamp) return cached = loaded;
		}
		return cached = load(fileStamp());
	},
};

registerServerConfigSource(configStore.read);

// The 0.1.x channels are gone: say so once instead of silently ignoring them.
const LEGACY = Symbol.for("lh.legacyConfigWarned");
const g = globalThis as Record<symbol, true | undefined>;
if (!g[LEGACY]) {
	g[LEGACY] = true;
	if (process.env.LH_AUTH_FILE) console.warn("[config] LH_AUTH_FILE is no longer read. Move its keys to \"keys\" in the config file (LH_CONFIG_FILE).");
	if (process.env.LH_CUSTOM_PROVIDERS) console.warn("[config] LH_CUSTOM_PROVIDERS is no longer read. Move its array to \"customProviders\" in the config file (LH_CONFIG_FILE).");
}
