/**
 * GET /api/keys — the auth page's key list (auth-keys wave, 2026-09-19;
 * providers added by the provider-keys interlude same wave).
 *
 * Every curated key (present or not) plus unknown config-file keys surfaced as
 * generic rows — ABSENT provider keys deliberately do NOT spam status
 * rows. `providers` carries the provider labels: {id, envVar, label} for every pi-ai plain-key provider,
 * derived from pi-ai's own provider→env-var table (no-drift pin in
 * tests/auth-provider-keys.test.ts) — the settings UI reads it optionally
 * with a graceful fallback.
 *
 * Masked only — last 4 + length for ordinary keys; custom keys are fully
 * redacted at every length (no credential suffix). PLAINTEXT NEVER LEAVES THE STORE THROUGH
 * THIS API (owner decision). `source` tells the page whether the live
 * value comes from the environment (dev .env.local / launch env) or the
 * config file, and `shadowedByEnv` explains why a saved key is not the live one
 * (env always wins). `claudeCode.enabled` is the config file's opt-in;
 * `configError` explains why the config file was ignored.
 */
import { claudeCodeEnabled, configError, keyStatuses, providerKeyList } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	const error = configError();
	return Response.json({
		keys: keyStatuses(),
		providers: providerKeyList(),
		claudeCode: { enabled: claudeCodeEnabled() },
		...(error ? { configError: error } : {}),
	});
}
