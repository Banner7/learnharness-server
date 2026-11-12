/**
 * The operator config file's schema and shared read seam (config wave,
 * v0.2.0). One read-only JSON object replaces auth.json, LH_CUSTOM_PROVIDERS
 * and the settings.json Claude Code opt-in:
 *
 *   { "version": 1,
 *     "keys": { "OPENROUTER_API_KEY": "...", ... },
 *     "customProviders": [ ...OpenAI-compatible providers... ],
 *     "claudeCode": { "enabled": true } }
 *
 * Every section is optional. The file itself is read by the store layer
 * (src/store/config.ts), which registers itself here so the agent layer
 * (custom providers) can read the parsed config without importing the store.
 * Server-only: never re-exported from the core barrel (zod + pi-ai catalogs).
 */

import { z } from "zod";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { CLAUDE_CODE_PROVIDER } from "./contracts/claude-code.ts";

/** Plain HTTP stays on hosts that never cross the public internet: loopback,
 *  private IPv4 ranges (10/8, 172.16/12, 192.168/16), single-label names
 *  (Docker service names such as `ollama`) and host.docker.internal. */
function privateHttpHost(hostname: string): boolean {
	if (["localhost", "127.0.0.1", "[::1]", "host.docker.internal"].includes(hostname)) return true;
	const ip = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(hostname);
	if (ip) {
		const [a, b] = [Number(ip[1]), Number(ip[2])];
		return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
	}
	return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(hostname) && !/^\d+$/.test(hostname);
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** An inline value, or `{"env": "NAME"}`: real env first, then keys.NAME.
 *  A reference never reaches gate or runtime configuration (LH_*, NODE_*),
 *  which would otherwise be sent to the provider's URL. */
const secret = z.union([z.string().min(1), z.object({
	env: z.string().regex(ENV_NAME).refine((name) => !/^(?:LH_|NODE_)/i.test(name), "an {\"env\"} reference must not name an LH_* or NODE_* variable"),
}).strict()]);
export type ConfigSecret = z.infer<typeof secret>;

const customProvider = z.object({
	id: z.string().regex(/^[a-z][a-z0-9-]*$/),
	name: z.string().min(1).optional(),
	baseUrl: z.string().url().refine((value) => {
		const url = new URL(value);
		return (url.protocol === "https:" || (url.protocol === "http:" && privateHttpHost(url.hostname))) && !url.username && !url.password && !url.search && !url.hash;
	}, "must be HTTPS (plain HTTP only for loopback, private IPv4, single-label or host.docker.internal hosts) without user info, query or fragment"),
	apiKey: secret.optional(),
	headers: z.record(z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/), secret).default({}),
	models: z.array(z.object({
		id: z.string().min(1), name: z.string().min(1).optional(),
		contextWindow: z.number().int().positive(), maxTokens: z.number().int().positive(),
		input: z.array(z.enum(["text", "image"])).min(1).default(["text"]),
		reasoning: z.boolean().default(false),
		compat: z.object({
			supportsStore: z.boolean().optional(), supportsDeveloperRole: z.boolean().optional(),
			supportsReasoningEffort: z.boolean().optional(), supportsUsageInStreaming: z.boolean().optional(),
			maxTokensField: z.enum(["max_tokens", "max_completion_tokens"]).optional(),
		}).strict().optional(),
	}).strict()).min(1),
}).strict();
export type CustomProviderDefinition = z.infer<typeof customProvider>;

const serverConfigSchema = z.object({
	version: z.literal(1).optional(),
	/** Empty values are ignored, so a template may keep blank placeholders. */
	keys: z.record(z.string().regex(ENV_NAME), z.string()).default({}),
	customProviders: z.array(customProvider).default([]),
	claudeCode: z.object({ enabled: z.boolean() }).strict().optional(),
}).strict();

export interface ServerConfig {
	keys: Readonly<Record<string, string>>;
	customProviders: readonly CustomProviderDefinition[];
	claudeCode: { enabled: boolean };
}

export interface LoadedServerConfig {
	config: ServerConfig;
	/** Why the file was ignored (whole file treated as empty); undefined
	 *  when it is valid or absent. Never contains values from the file. */
	error?: string;
	/** Changes whenever the parsed content may have changed. */
	stamp: string;
}

export const EMPTY_SERVER_CONFIG: ServerConfig = Object.freeze({ keys: Object.freeze({}), customProviders: Object.freeze([]), claudeCode: Object.freeze({ enabled: false }) });

let reserved: ReadonlySet<string> | undefined;

/** A field name or path segment as shown in errors (log and Providers page):
 *  a secret pasted as an object key must not be echoed, so anything that
 *  does not look like an identifier (or looks like a random token) is hidden. */
function shownName(name: string): string {
	const identifier = /^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(name) && (name.match(/\d/g)?.length ?? 0) < 4;
	return identifier ? name : "(name hidden)";
}

/** Parse the file text. Throws an Error whose message names the problem
 *  (field path) but never echoes file content: it may hold secrets. */
export function parseServerConfig(text: string): ServerConfig {
	let raw: unknown;
	try { raw = JSON.parse(text); } catch { throw new Error("the file is not valid JSON"); }
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("the file must hold a JSON object");
	const result = serverConfigSchema.safeParse(raw);
	if (!result.success) {
		let issue = result.error.issues[0]!;
		// A secret is a union (string | {"env"}): surface the {"env"} rule's own
		// message instead of a bare "Invalid input".
		if (issue.code === "invalid_union") {
			const custom = issue.errors.flat().find((nested) => nested.code === "custom");
			if (custom) issue = { ...custom, path: [...issue.path, ...custom.path] };
		}
		const where = issue.path.length ? issue.path.map((segment) => typeof segment === "number" ? String(segment) : shownName(String(segment))).join(".") : "(top level)";
		const problem = issue.code === "unrecognized_keys" ? `unknown field ${issue.keys.map((k) => shownName(k) === k ? `"${k}"` : "(name hidden)").join(", ")}` : issue.message;
		throw new Error(`${where}: ${problem}`);
	}
	// A configured id must never replace a built-in provider's routes.
	reserved ??= new Set([...builtinProviders().map((provider) => provider.id), CLAUDE_CODE_PROVIDER]);
	const ids = new Set<string>();
	for (const item of result.data.customProviders) {
		if (reserved.has(item.id)) throw new Error(`customProviders: provider id "${item.id}" is reserved by a built-in provider`);
		if (ids.has(item.id)) throw new Error(`customProviders: duplicate provider id "${item.id}"`);
		if (new Set(item.models.map((model) => model.id)).size !== item.models.length) throw new Error(`customProviders: duplicate model id in "${item.id}"`);
		ids.add(item.id);
	}
	return {
		keys: Object.fromEntries(Object.entries(result.data.keys).filter(([, value]) => value !== "")),
		customProviders: result.data.customProviders,
		claudeCode: { enabled: result.data.claudeCode?.enabled === true },
	};
}

// The store registers its reader here (HMR-stable, like core/auth-env.ts).
const SOURCE_KEY = Symbol.for("lh.serverConfigSource");
type Source = () => LoadedServerConfig;

export function registerServerConfigSource(source: Source): void {
	(globalThis as Record<symbol, Source | undefined>)[SOURCE_KEY] = source;
}

/** The current parsed config; empty until the store module is loaded. */
export function serverConfig(): LoadedServerConfig {
	const source = (globalThis as Record<symbol, Source | undefined>)[SOURCE_KEY];
	return source ? source() : { config: EMPTY_SERVER_CONFIG, stamp: "" };
}
