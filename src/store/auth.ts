/**
 * The AuthStore adapter (auth-keys wave, 2026-09-19): the flat {VAR: value}
 * auth.json map at config.AUTH_FILE. The file is managed on the server host
 * (mode 0600); the app only reads it. Every access stats the file and
 * re-parses it only when it changed, so hand edits take effect without a
 * restart. Reads never throw (absent/corrupt file = {} = "no keys yet");
 * non-string values are ignored.
 */

import fs from "node:fs";
import { AUTH_FILE } from "../../config.ts";
import type { AuthStore } from "../core/ports.ts";

let cached: { stamp: string; map: Record<string, string> } | undefined;

/** The file's identity for change detection; "" when it is absent. */
function fileStamp(): string {
	try {
		const st = fs.statSync(AUTH_FILE);
		return `${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`;
	} catch {
		return "";
	}
}

/** The flat string→string map, or {} for absent/corrupt/non-object. */
function readMap(): Record<string, string> {
	const stamp = fileStamp();
	if (cached?.stamp !== stamp) cached = { stamp, map: parseMap() };
	return { ...cached.map };
}

function parseMap(): Record<string, string> {
	try {
		const raw = JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8"));
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
		return Object.fromEntries(
			Object.entries(raw).filter(([, v]) => typeof v === "string") as [string, string][],
		);
	} catch {
		return {}; // absent or corrupt — the documented state is "no keys yet"
	}
}

export const authStore: AuthStore = {
	authVars() {
		return readMap();
	},
};
