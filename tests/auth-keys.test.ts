/**
 * The curated auth-key catalog + shape rules (auth-keys wave, 2026-09-19;
 * search wave 2026-09-20: the Google CSE pair retired, Tavily + Brave in)
 * — PURE module, so this file owns no fs. Owner decisions being pinned:
 *  - the catalog contains the known keys, ids = env-var names;
 *  - validation is SHAPE-ONLY (no live pings) and bad pastes are 400s;
 *  - masking is last-4 + length — plaintext never leaves the store.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AUTH_KEYS, isKnownAuthKey, maskKey } from "../src/core/auth-keys.ts";

describe("the catalog", () => {
	it("lists the curated app-service keys (provider keys live in the provider table)", () => {
		assert.deepEqual(
			AUTH_KEYS.map((k) => k.id),
			["DEEPGRAM_API_KEY", "TAVILY_API_KEY", "BRAVE_API_KEY", "EXA_API_KEY", "FIRECRAWL_API_KEY", "OLLAMA_API_KEY"],
		);
		for (const k of AUTH_KEYS) {
			assert.ok(k.label.length > 0, `${k.id} has a label`);
			assert.ok(k.description.length > 0, `${k.id} has a description`);
			assert.ok(k.docsUrl.startsWith("https://"), `${k.id} has a docs link`);
		}
		// OPENROUTER_API_KEY graduated to the provider table (owner decision,
		// provider-keys interlude) — not curated anymore. The Google CSE
		// pair retired with its engine (search wave, 2026-09-20).
		assert.ok(!isKnownAuthKey("OPENROUTER_API_KEY"));
		assert.ok(!isKnownAuthKey("GOOGLE_SEARCH_API_KEY"), "the CSE pair is retired");
		assert.ok(!isKnownAuthKey("GOOGLE_CSE_ID"));
	});

	it("isKnownAuthKey: catalog yes, everything else no", () => {
		assert.ok(isKnownAuthKey("DEEPGRAM_API_KEY"));
		assert.ok(isKnownAuthKey("TAVILY_API_KEY"));
		assert.ok(isKnownAuthKey("BRAVE_API_KEY"));
		assert.ok(isKnownAuthKey("EXA_API_KEY"));
		assert.ok(isKnownAuthKey("FIRECRAWL_API_KEY"));
		assert.ok(isKnownAuthKey("OLLAMA_API_KEY"));
		assert.ok(!isKnownAuthKey("OPENROUTER_API_KEY"));
		assert.ok(!isKnownAuthKey("OPENAI_API_KEY"), "provider vars are a separate surface");
		assert.ok(!isKnownAuthKey("FUTURE_PLANS_TOKEN"));
		assert.ok(!isKnownAuthKey(""));
	});
});

describe("maskKey (plaintext never leaves)", () => {
	it("shows the last 4 only", () => {
		assert.equal(maskKey("sk-or-v1-abcdefgh1234"), "…1234");
	});

	it("never reveals a degenerate short value in full", () => {
		assert.equal(maskKey("ab"), "…ab");
		assert.equal(maskKey("abcd"), "…abcd");
		assert.equal(maskKey("abcde"), "…bcde");
	});

	it("trims before masking", () => {
		assert.equal(maskKey("  sk-or-v1-xyzw9  "), "…yzw9");
	});
});
