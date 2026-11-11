/**
 * The auth/keys composition (auth-keys wave, 2026-09-19): the server-side
 * key status behind GET /api/keys. Credentials are configured on the server
 * only (environment or the auth file); the browser never writes them.
 *
 * THE ENV SEAM (the architecture keystone): every consumer — models.ts's
 * openRouterApiKey(), the sub-agents, web.ts, the STT route — reads
 * process.env directly, and the agent layer may not import the store
 * layer. Instead the store REFLECTS itself into the process env: at boot,
 * and again on every key read (initAuthEnv, cheap: the store re-parses the
 * file only when it changed), every file var not owned by the real env is
 * mirrored into process.env, changed values are updated and vars removed
 * from the file are deleted again — so hand edits take effect without a
 * restart. Provenance is anchored on globalThis like the extraction registry.
 *
 * PRECEDENCE (owner decision): real environment variables always win over
 * the file. Real-env vars are snapshotted at boot (plus any name found set
 * in the env that this module did not set) and never mutated; the status
 * honestly reports shadowedByEnv when the file holds a copy that is not the
 * live one.
 *
 * Unknown vars in the file are preserved verbatim and surfaced as
 * generic status rows (only curated keys have shapes and docs;
 * core/auth-keys.ts).
 *
 * THE FRESH-USER SWITCH (owner, interlude 2026-09-22): LH_IGNORE_ENV_KEYS=1
 * makes every env key invisible APP-WIDE — the exact new-user simulation
 * (a fresh empty data dir + the switch = zero keys, zero federated
 * providers, setup stage 1). Under the switch real env vars are DELETED
 * from the process (not merely ignored by this seam): pi-ai resolves
 * provider keys from process.env NATIVELY at every request
 * (auth/context.js's defaultProviderAuthContext reads live env), so
 * deletion is the one mechanism that hides keys from every consumer —
 * model engines included. Only the file store (auth.json) counts. Unset
 * switch = today's behavior, byte-for-byte.
 */

import {
	AUTH_KEYS,
	AUTH_PROVIDER_KEYS,
	AUTH_PROVIDER_ENV_VARS,
	type AuthKeyInfo,
	type AuthKeyStatus,
	maskKey,
} from "../core/auth-keys.ts";
import { authStore } from "../store/auth.ts";
import { customProviderEnvVars, customProviderIds, customProviderPresent } from "../agent/custom-providers.ts";
import { claudeCodeAvailable } from "./claude-code-config.ts";
import { CLAUDE_CODE_PROVIDER } from "../agent/claude-code/constants.ts";

// Shared HMR-stable provenance lets external CLIs exclude file-only injections
// without importing this store-backed module into the agent layer.
import { authEnvRecord as boot } from "../core/auth-env.ts";

/** Has this process taken its real-env snapshot yet (HMR re-imports share
 *  the globalThis record, so a module-level flag may re-snapshot: harmless,
 *  names this module set are excluded via fillGap). */
let snapshotted = false;

/** The settings page's provider dropdown: every pi-ai provider that takes
 *  a plain key ({id, envVar, label} — no-drift-pinned, see the table's doc
 *  in core/auth-keys.ts and tests/auth-provider-keys.test.ts). Sorted by
 *  id for a stable payload. */
export function providerKeyList() {
	return [...AUTH_PROVIDER_KEYS].sort((a, b) => a.id.localeCompare(b.id));
}

/** The fresh-user switch (owner, interlude 2026-09-22): env keys are
 *  invisible app-wide — deleted from the process at boot, file keys only.
 *  Read live per call (the launcher exports it before boot). */
export function envKeysIgnored(): boolean {
	return process.env.LH_IGNORE_ENV_KEYS === "1";
}

/**
 * Mirror the auth file into process.env — idempotent, run at boot and on
 * every key read. The first call snapshots which managed names are real env.
 * Every call then: deletes reflections whose var left the file, updates
 * reflections whose value changed, and fills file vars unset in the env.
 * Real env vars are never touched.
 */
export function initAuthEnv(): void {
	const record = boot();
	const known = new Set<string>([
		...AUTH_KEYS.map((k) => k.id),
		// Provider env vars are managed names too (provider-keys interlude):
		// an env-exported OPENAI_API_KEY with a file copy gets honest shadow
		// semantics, exactly like the curated vars.
		...AUTH_PROVIDER_KEYS.map((p) => p.envVar),
		...customProviderEnvVars(),
	]);
	// Only key-shaped names are mirrored: the file must never set gate config
	// (LH_*), runtime switches (NODE_OPTIONS) or PATH/HOME. Other entries stay
	// in the file and show as status rows, but never reach process.env.
	const fileVars = Object.fromEntries(Object.entries(authStore.authVars()).filter(([name]) =>
		!name.startsWith("LH_") && !name.startsWith("NODE_") &&
		(known.has(name) || /_(?:API_KEY|TOKEN|SECRET)$/.test(name))));
	const managed = new Set<string>([...Object.keys(fileVars), ...known]);
	if (envKeysIgnored()) {
		// THE FRESH-USER SWITCH: delete every managed env var (re-run on
		// every call — a reintroduced var never resurrects). realEnv stays
		// EMPTY (nothing counts as env); the fill-gap below then reflects
		// auth.json keys so engines still see mid-session additions.
		for (const name of managed) {
			delete process.env[name];
		}
	} else if (!snapshotted) {
		// First sync in this process: what's already in the env is REAL env.
		snapshotted = true;
		for (const name of managed) {
			if (process.env[name] !== undefined && !record.fillGap.has(name)) record.realEnv.add(name);
		}
	}
	for (const name of record.fillGap) {
		if (fileVars[name] !== undefined) continue;
		if (!record.realEnv.has(name)) delete process.env[name];
		record.fillGap.delete(name);
	}
	for (const [name, value] of Object.entries(fileVars)) {
		if (record.realEnv.has(name)) continue;
		if (record.fillGap.has(name) || process.env[name] === undefined) {
			process.env[name] = value;
			record.fillGap.add(name);
		} else {
			// Set, but not by this module: a real env var the boot snapshot
			// did not know as a managed name. Real env wins.
			record.realEnv.add(name);
		}
	}
}

/**
 * The pure status projection — exported for tests. `env` is the live
 * process env view; `realEnv` the boot snapshot (env precedence).
 */
export function resolveKeyStatuses(
	fileVars: Record<string, string>,
	env: Record<string, string | undefined>,
	realEnv: ReadonlySet<string>,
	/** The model-provider env vars (provider-keys interlude): PRESENT ones
	 *  join the status rows — absent ones never spam (the dropdown is the
	 *  discovery surface). Curated keys always get rows, present or not. */
	providerEnvVars: ReadonlySet<string> = new Set(),
	/** Names whose values may be arbitrarily short (LH_CUSTOM_PROVIDERS
	 *  secrets): listed, but no key characters returned. */
	opaqueEnvVars: ReadonlySet<string> = new Set(),
): AuthKeyStatus[] {
	const ids = new Set<string>([...AUTH_KEYS.map((k) => k.id), ...Object.keys(fileVars)]);
	for (const envVar of providerEnvVars) {
		if (env[envVar] !== undefined || fileVars[envVar] !== undefined) ids.add(envVar);
	}
	const rows: AuthKeyStatus[] = [];
	for (const id of ids) {
		const envValue = env[id];
		const fileValue = fileVars[id];
		const isRealEnv = realEnv.has(id);
		// Env wins: the live value is the env's when set (real or reflected —
		// post fill-gap the file's values LIVE in env, so realEnv is what
		// distinguishes a REAL env var from the store's own reflection).
		const live = envValue !== undefined ? envValue : fileValue;
		rows.push({
			id,
			info: AUTH_KEYS.find((k) => k.id === id) ?? null,
			present: live !== undefined,
			// Custom secrets may be one character: even a masked suffix can expose
			// the entire credential. Preserve inventory, return no key characters.
			masked: live !== undefined ? opaqueEnvVars.has(id) ? "••••" : `${maskKey(live)} (${live.trim().length} chars)` : null,
			source: isRealEnv ? "env" : live !== undefined ? "file" : "none",
			shadowedByEnv: isRealEnv && fileValue !== undefined && envValue !== fileValue,
		});
	}
	return rows;
}

/** The GET view: every curated key (present or not) + unknown file vars. */
export function keyStatuses(): AuthKeyStatus[] {
	initAuthEnv();
	const custom = new Set(customProviderEnvVars());
	return resolveKeyStatuses(authStore.authVars(), process.env, boot().realEnv, new Set([...AUTH_PROVIDER_ENV_VARS, ...custom]), custom);
}

/** The live value for one var, env-first (the env-wins rule) — the canonical
 *  read for consumers that don't live behind the @/src/server barrel (the
 *  STT route was the one cold-boot hole: a first-ever request to it would
 *  otherwise read env before any fill-gap ran). */
export function keyValue(id: string): string | undefined {
	initAuthEnv();
	// The fresh-user switch: ONLY the file store counts (belt-and-
	// suspenders — the boot deletion already emptied the env; this guards
	// any env key reintroduced after boot).
	if (envKeysIgnored()) return authStore.authVars()[id];
	return process.env[id] ?? authStore.authVars()[id];
}

/** The key-presence truth for one model provider (provider-key interlude,
 * 2026-09-25): would this provider's key be present at request time?
 * Reads through keyValue — the SAME env-first lookup pi-ai performs
 * natively at every request — so an env-shadowed key counts as present
 * (gate by what would run). LH_CUSTOM_PROVIDERS entries are present when
 * every referenced env var is set. Providers absent from AUTH_PROVIDER_KEYS
 * take no key at all: nothing to gate, present by definition. */
export function providerKeyPresent(provider: string): boolean {
	if (customProviderIds().includes(provider)) return customProviderPresent(provider);
	// Explicit opt-in + installation only, never authentication readiness.
	// Consulted at admission, not inside already-running agent loops.
	if (provider === CLAUDE_CODE_PROVIDER) return claudeCodeAvailable();
	const info = AUTH_PROVIDER_KEYS.find((p) => p.id === provider);
	return info ? keyValue(info.envVar) !== undefined : true;
}

// Reflect the file into the env at first import (idempotent; the module is
// imported by every route/handler path that touches keys).
initAuthEnv();
