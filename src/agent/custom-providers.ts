import { createProvider, type AssistantMessage, type Provider, type StreamFunction } from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { authEnvRecord } from "../core/auth-env.ts";
import { serverConfig, type ConfigSecret, type CustomProviderDefinition } from "../core/server-config.ts";

/** The operator config file's customProviders (core/server-config.ts),
 *  read through the store's registered reader: auth material never enters
 *  settings/catalog DTOs. An invalid file yields none; built-ins still work. */
function configured(): readonly CustomProviderDefinition[] {
	return serverConfig().config.customProviders;
}

/** Changes whenever the configured custom providers may have changed:
 *  piModels() re-registers them when it does. */
export function customProvidersStamp(): string {
	return serverConfig().stamp;
}

/** `{"env": "NAME"}`: the real environment wins, then keys.NAME from the
 *  config file. A value LearnHarness itself mirrored into process.env is
 *  skipped in favor of the file's current copy (it may be stale). */
function resolve(value: ConfigSecret): string | undefined {
	let result: string | undefined;
	if (typeof value === "string") result = value;
	else {
		const env = process.env[value.env];
		result = env !== undefined && !authEnvRecord().fillGap.has(value.env)
			? env
			: serverConfig().config.keys[value.env] ?? env;
	}
	if (result !== undefined && (!result || /[\r\n\x00]/.test(result))) throw new Error("Invalid custom provider authentication value");
	return result;
}
function authentication(config: CustomProviderDefinition) {
	const apiKey = config.apiKey === undefined ? undefined : resolve(config.apiKey);
	if (config.apiKey !== undefined && apiKey === undefined) return undefined;
	const headers: Record<string, string | null> = {};
	for (const [name, value] of Object.entries(config.headers)) {
		const resolved = resolve(value);
		if (resolved === undefined) return undefined;
		headers[name] = resolved;
	}
	// The adapter requires a key even when a gateway owns auth. Suppress
	// Authorization so the SDK sentinel is never sent as a bearer token.
	if (!apiKey && !Object.keys(headers).some((name) => name.toLowerCase() === "authorization")) headers.Authorization = null;
	return { apiKey: apiKey ?? "unused", headers };
}
export function customProviderIds(): string[] { return configured().map((item) => item.id); }
// Expose only configured names and ids to the catalog, never endpoint or auth material.
export function customProviderSummaries(): Array<{ id: string; name: string }> {
	return configured().map((item) => ({ id: item.id, name: item.name ?? item.id }));
}
export function customProviderPresent(id: string): boolean {
	const config = configured().find((item) => item.id === id);
	return !!config && authentication(config) !== undefined;
}
export function customProviderEnvVars(): string[] {
	return configured().flatMap((item) => [item.apiKey, ...Object.values(item.headers)].flatMap((value) => value && typeof value !== "string" ? [value.env] : []));
}
export function customProviders(): Provider[] {
	return configured().map((config) => createProvider({
		id: config.id, name: config.name ?? config.id, baseUrl: config.baseUrl,
		auth: { apiKey: { name: `${config.name ?? config.id} authentication`, resolve: async () => {
			const auth = authentication(config);
			return auth ? { auth, source: "config file" } : undefined;
		} } },
		models: config.models.map((model) => ({
			...model, name: model.name ?? model.id, provider: config.id, api: "openai-completions" as const,
			baseUrl: config.baseUrl, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" as const, ...model.compat },
		})),
		api: openAICompletionsApi(),
	}));
}

// Shared process-wide queues survive HMR. Serialize whole requests (including
// foreground requests) so background agents cannot overlap on a small endpoint.
const QUEUES = Symbol.for("lh.customProviderQueues");
function queues(): Map<string, Promise<void>> {
	const state = globalThis as typeof globalThis & { [QUEUES]?: Map<string, Promise<void>> };
	return state[QUEUES] ??= new Map();
}
/** SDK error events are forwarded unchanged. Unexpected thrown failures retain
 * safe transport/status categories, never raw messages that may contain auth. */
function customFailureMessage(error: unknown): string {
	const details = error && typeof error === "object" ? error as { status?: unknown; code?: unknown; cause?: { code?: unknown } } : undefined;
	const status = details?.status;
	if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) {
		const category = status === 401 || status === 403 ? "authentication/authorization" : status === 429 ? "rate limit" : status >= 500 ? "upstream server" : "request";
		return `Custom provider ${category} failure (HTTP ${status}). Check endpoint configuration and provider access.`;
	}
	const code = details?.code ?? details?.cause?.code;
	if (typeof code === "string" && ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"].includes(code)) {
		return `Custom provider transport failure (${code}). Check endpoint connectivity and TLS configuration.`;
	}
	if (error instanceof Error && error.message === "Custom provider stream ended without a response") return error.message;
	const category = error instanceof TypeError ? "TypeError" : error instanceof RangeError ? "RangeError" : error instanceof SyntaxError ? "SyntaxError" : "unexpected error";
	return `Custom provider request failed (${category}). Check endpoint configuration and provider integration.`;
}

export function serializedCustomStream(stream: StreamFunction): StreamFunction {
	return (model, context, options) => {
		const output = new AssistantMessageEventStream();
		const queue = queues(), previous = queue.get(model.provider) ?? Promise.resolve();
		// ES2023 project typings predate Promise.withResolvers.
		let release!: () => void;
		const held = new Promise<void>((resolve) => { release = resolve; });
		const pending = previous.then(() => held);
		queue.set(model.provider, pending);
		void (async () => {
			let terminal = false;
			let partial: AssistantMessage | undefined;
			let cancel: (() => void) | undefined;
			try {
				options?.signal?.throwIfAborted();
				if (options?.signal) {
					const signal = options.signal;
					// Constructor form preserves compatibility with ES2023 typings.
					const aborted = new Promise<void>((_resolve, reject) => { cancel = () => reject(signal.reason); });
					signal.addEventListener("abort", cancel!, { once: true });
					await Promise.race([previous, aborted]);
				} else await previous;
				options?.signal?.throwIfAborted();
				for await (const event of stream(model, context, options)) {
					if (event.type === "done" || event.type === "error") terminal = true;
					partial = "partial" in event ? event.partial : event.type === "done" ? event.message : event.error;
					output.push(event);
				}
				if (!terminal) throw new Error("Custom provider stream ended without a response");
			} catch (cause) {
				if (!terminal) {
					const error: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
						content: [], timestamp: Date.now(), stopReason: options?.signal?.aborted ? "aborted" : "error",
						errorMessage: options?.signal?.aborted ? "Custom provider request cancelled." : customFailureMessage(cause),
						usage: partial?.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
					if (partial) error.content = partial.content;
					output.push({ type: "error", reason: error.stopReason as "error" | "aborted", error });
				}
			} finally {
				if (cancel) options?.signal?.removeEventListener("abort", cancel);
				release();
				void pending.then(() => { if (queue.get(model.provider) === pending) queue.delete(model.provider); });
				output.end();
			}
		})();
		return output;
	};
}

