/**
 * The auth/keys composition (auth-keys wave, 2026-09-19): the server-side
 * key status behind GET /api/keys. Credentials are configured on the server
 * only (environment or the operator config file's `keys`); the browser never
 * writes them.
 *
 * THE ENV SEAM (the architecture keystone): every consumer — models.ts's
 * openRouterApiKey(), the sub-agents, web.ts — reads
 * process.env directly, and the agent layer may not import the store
 * layer. Instead the config file's keys are REFLECTED into the process env: at boot,
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
 * Unknown vars in the file's keys are surfaced as generic status rows (only
 * curated keys carry labels and docs links; core/auth-keys.ts).
 */

import {
	AUTH_KEYS,
	AUTH_PROVIDER_KEYS,
	AUTH_PROVIDER_ENV_VARS,
	type AuthKeyInfo,
	type AuthKeyStatus,
	FULL_MASK,
	maskKey,
} from "../core/auth-keys.ts";
import { piModels } from "../agent/models.ts";
import { configStore } from "../store/config.ts";
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

/** The removed in-app custom provider's key name, as copied from upstream
 *  auth.json files. */
const UPSTREAM_CUSTOM_KEY = "CUSTOM_OPENAI_API_KEY";
function isFossil(name: string): boolean {
	return name.startsWith("__") || name === UPSTREAM_CUSTOM_KEY;
}

/** Every pi-ai provider that takes a plain key ({id, envVar, label} —
 *  no-drift-pinned, see the table's doc in core/auth-keys.ts and
 *  tests/auth-provider-keys.test.ts): the Providers section's labels.
 *  Sorted by id for a stable payload. */
export function providerKeyList() {
	return [...AUTH_PROVIDER_KEYS].sort((a, b) => a.id.localeCompare(b.id));
}

/** Why the config file was ignored (shown on the Providers page). */
export function configError(): string | undefined {
	return configStore.read().error;
}

/** The config file's keys, minus empty values (the parser drops them). */
function fileKeys(): Record<string, string> {
	return { ...configStore.read().config.keys };
}

/**
 * Mirror the config file's keys into process.env — idempotent, run at boot and on
 * every key read. The first call snapshots which managed names are real env.
 * Every call then: deletes reflections whose var left the file, updates
 * reflections whose value changed, and fills file vars unset in the env.
 * Real env vars are never touched.
 */
/** What the last full sync saw: the config stamp, and the env value of every
 *  managed name right after it. Unchanged on the next call means the sync
 *  would be a no-op; any change to a managed variable (set, unset, edited by
 *  anyone) or to the config file forces the full pass, so the precedence
 *  rules below are always applied to the current state. */
let lastSync: { stamp: string; names: string[]; values: (string | undefined)[] } | undefined;

export function initAuthEnv(): void {
	const loaded = configStore.read();
	if (lastSync && lastSync.stamp === loaded.stamp && lastSync.names.every((name, i) => process.env[name] === lastSync!.values[i])) return;
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
	// Upstream fossils (`__*` bindings, CUSTOM_OPENAI_API_KEY from the removed
	// in-app custom provider) are never mirrored.
	const fileVars = Object.fromEntries(Object.entries(loaded.config.keys).filter(([name]) =>
		!name.startsWith("LH_") && !name.startsWith("NODE_") && !isFossil(name) &&
		(known.has(name) || /_(?:API_KEY|TOKEN|SECRET)$/.test(name))));
	const managed = new Set<string>([...Object.keys(fileVars), ...known]);
	if (!snapshotted) {
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
	const names = [...new Set([...managed, ...record.fillGap])];
	lastSync = { stamp: loaded.stamp, names, values: names.map((name) => process.env[name]) };
}

/**
 * The pure status projection. `env` is the live process env view;
 * `realEnv` the boot snapshot (env precedence).
 */
function resolveKeyStatuses(
	fileVars: Record<string, string>,
	env: Record<string, string | undefined>,
	realEnv: ReadonlySet<string>,
	/** The model-provider env vars (provider-keys interlude): PRESENT ones
	 *  join the status rows — absent ones never spam (the `providers` list
	 *  carries their labels). Curated keys always get rows, present or not. */
	providerEnvVars: ReadonlySet<string> = new Set(),
	/** Names whose values may be arbitrarily short (custom provider
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
			masked: live !== undefined ? opaqueEnvVars.has(id) ? FULL_MASK : `${maskKey(live)} (${live.trim().length} chars)` : null,
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
	// Internal `__*` entries are not keys: never listed. The upstream custom
	// key is listed fully redacted, like custom provider secrets.
	const fileVars = Object.fromEntries(Object.entries(fileKeys()).filter(([name]) => !name.startsWith("__")));
	// The env view holds only names the mirror may manage: a file key named
	// LH_WEB_ACCESS_TOKEN (say) must not reveal the real variable's suffix.
	const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("LH_") && !name.startsWith("NODE_")));
	return resolveKeyStatuses(fileVars, env, boot().realEnv, new Set([...AUTH_PROVIDER_ENV_VARS, ...custom]), new Set([...custom, UPSTREAM_CUSTOM_KEY]));
}

/** The live value for one var, env-first (the env-wins rule) — the canonical
 *  read for consumers that don't live behind the @/src/server barrel. */
/** keyValue for many lookups: one sync and one config read, then plain
 *  lookups (the providers surface asks for ~35 keys at once). */
export function keySnapshot(): (id: string) => string | undefined {
	initAuthEnv();
	const keys = fileKeys();
	return (id) => process.env[id] ?? keys[id];
}

export function keyValue(id: string): string | undefined {
	initAuthEnv();
	return process.env[id] ?? fileKeys()[id];
}

/** The key-presence truth for one model provider (provider-key interlude,
 * 2026-09-25): would this provider's key be present at request time?
 * Reads through keyValue — the SAME env-first lookup pi-ai performs
 * natively at every request — so an env-shadowed key counts as present
 * (gate by what would run). Config-file custom providers are present when
 * every referenced secret resolves. Other providers registered in the live model
 * collection take no plain key: nothing to gate, present by definition. Any other id (a retired upstream
 * provider such as chatgpt, *-subscription or custom left in migrated
 * settings) is never present, so admission refuses it with the setup
 * envelope instead of failing later in the catalog lookup. */
export function providerKeyPresent(provider: string): boolean {
	if (customProviderIds().includes(provider)) return customProviderPresent(provider);
	// Explicit opt-in + installation only, never authentication readiness.
	// Consulted at admission, not inside already-running agent loops.
	if (provider === CLAUDE_CODE_PROVIDER) return claudeCodeAvailable();
	const info = AUTH_PROVIDER_KEYS.find((p) => p.id === provider);
	return info ? keyValue(info.envVar) !== undefined : piModels().getProvider(provider) !== undefined;
}

// Reflect the file into the env at first import (idempotent; the module is
// imported by every route/handler path that touches keys).
initAuthEnv();
