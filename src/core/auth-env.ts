/** Shared provenance only: no credential-store reads in the agent layer. */
interface AuthBoot {
	/** Names owned by the original launch environment. */
	realEnv: Set<string>;
	/** Names reflected into process.env by LearnHarness's key store. */
	fillGap: Set<string>;
}
const BOOT_KEY = Symbol.for("lh.authBoot");

export function authEnvRecord(): AuthBoot {
	const g = globalThis as Record<symbol, AuthBoot | undefined>;
	if (!g[BOOT_KEY]) g[BOOT_KEY] = { realEnv: new Set(), fillGap: new Set() };
	return g[BOOT_KEY];
}

/** What an external CLI may see: its own auth/config, Bedrock/Vertex
 *  routing (AWS_*, GOOGLE_*, CLOUD_ML_REGION), XDG dirs, locale, temp,
 *  proxy and TLS settings. Never LH_* (gate token, custom-provider secrets)
 *  or other providers' keys. PATH and proxy names match in any case. */
const CLI_ENV_NAMES: Record<string, true> = {
	HOME: true, USER: true, SHELL: true, LANG: true, TZ: true, TMPDIR: true, DISABLE_AUTOUPDATER: true,
	NODE_EXTRA_CA_CERTS: true, CLAUDE_CODE_OAUTH_TOKEN: true, CLOUD_ML_REGION: true,
};
const CLI_ENV_PREFIXES = ["LC_", "CLAUDE_", "ANTHROPIC_", "SSL_CERT_", "AWS_", "GOOGLE_", "XDG_"];

/** Config-file keys that exist only for an external CLI: mirrored values
 *  are passed. Other mirrored keys (e.g. ANTHROPIC_API_KEY for LearnHarness's
 *  own Anthropic provider) never reach the CLI, so they cannot switch its
 *  billing. */
const CLI_FILE_KEYS: Record<string, true> = { CLAUDE_CODE_OAUTH_TOKEN: true };

/** External CLIs own their authentication. Pass only the allowlist above,
 *  and never LearnHarness-only injections mirrored from the config file. */
export function externalCliEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const { realEnv, fillGap } = authEnvRecord();
	const result: Record<string, string> = {};
	for (const [name, value] of Object.entries(env)) {
		if (value === undefined) continue;
		const allowed = CLI_ENV_NAMES[name] || /^(?:path|(?:https?|no)_proxy)$/i.test(name) || CLI_ENV_PREFIXES.some((prefix) => name.startsWith(prefix));
		if (!allowed || (fillGap.has(name) && !realEnv.has(name) && !CLI_FILE_KEYS[name])) continue;
		result[name] = value;
	}
	return result as Partial<NodeJS.ProcessEnv> as NodeJS.ProcessEnv;
}
