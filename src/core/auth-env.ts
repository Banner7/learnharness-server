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

/** What an external CLI may see: its own auth/config, locale, temp, proxy
 *  and TLS settings. Never LH_* (gate token, custom-provider secrets) or
 *  other providers' keys. Proxy names match in any case. */
const CLI_ENV_NAMES: Record<string, true> = {
	PATH: true, HOME: true, LANG: true, TZ: true, TMPDIR: true, DISABLE_AUTOUPDATER: true,
	NODE_EXTRA_CA_CERTS: true, CLAUDE_CODE_OAUTH_TOKEN: true,
};
const CLI_ENV_PREFIXES = ["LC_", "CLAUDE_", "ANTHROPIC_", "SSL_CERT_"];

/** External CLIs own their authentication. Pass only the allowlist above,
 *  and never LearnHarness-only injections mirrored from the auth file. */
export function externalCliEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const { realEnv, fillGap } = authEnvRecord();
	const result: Record<string, string> = {};
	for (const [name, value] of Object.entries(env)) {
		if (value === undefined) continue;
		const allowed = CLI_ENV_NAMES[name] || /^(?:https?|no)_proxy$/i.test(name) || CLI_ENV_PREFIXES.some((prefix) => name.startsWith(prefix));
		if (!allowed || (fillGap.has(name) && !realEnv.has(name))) continue;
		result[name] = value;
	}
	return result as Partial<NodeJS.ProcessEnv> as NodeJS.ProcessEnv;
}
