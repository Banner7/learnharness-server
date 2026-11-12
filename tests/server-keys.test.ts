/** File credential reflection and env-first precedence, using throwaway keys. */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { externalCliEnv } from "../src/core/auth-env.ts";

// THIS PROCESS'S ENV IS THE TEST SUBJECT — strip any inherited catalog vars
// (a developer shell may export REAL keys; tests use throwaway values only,
// never real secrets). The strip affects only this disposable child process.
for (const varName of [
	"OPENROUTER_API_KEY",
	"TAVILY_API_KEY",
	"BRAVE_API_KEY",
	"GOOGLE_SEARCH_API_KEY",
	"GOOGLE_CSE_ID",
	"OPENAI_API_KEY",
	"FUTURE_PLANS_TOKEN",
]) {
	delete process.env[varName];
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-server-keys-"));
const AUTH = path.join(TMP, "config.json");
process.env.LH_CONFIG_FILE = AUTH;

// Existing file credentials: an env-shadowed provider and an opaque var.
fs.writeFileSync(
	AUTH,
	JSON.stringify({ keys: {
		OPENROUTER_API_KEY: "sk-or-v1-filefilefile",
		FUTURE_PLANS_TOKEN: "opaque-plans-token",
	} }),
);
// Real environment values are present before importing the credential seam.
process.env.OPENROUTER_API_KEY = "sk-or-v1-envvalue99";

// Import AFTER env setup so module initialization fills only unset values.
const { keyValue, providerKeyPresent } = await import(
	"../src/server/keys.ts"
);
const { configStore } = await import("../src/store/config.ts");

const ENV_OWNED = "sk-or-v1-envvalue99";

after(() => {
	delete process.env.OPENROUTER_API_KEY;
	delete process.env.BRAVE_API_KEY;
	delete process.env.OPENAI_API_KEY;
	fs.rmSync(TMP, { recursive: true, force: true });
});

describe("boot fill-gap + precedence", () => {
	it("env-owned var wins and the file copy is untouched", () => {
		assert.equal(process.env.OPENROUTER_API_KEY, ENV_OWNED);
		assert.equal(configStore.read().config.keys?.OPENROUTER_API_KEY, "sk-or-v1-filefilefile", "file copy untouched");
		assert.equal(externalCliEnv().OPENROUTER_API_KEY, undefined, "external CLIs get an allowlisted environment, not provider keys");
	});

	it("unknown file vars are reflected into the environment", () => {
		assert.equal(process.env.FUTURE_PLANS_TOKEN, "opaque-plans-token", "reflected at boot");
		assert.equal(externalCliEnv().FUTURE_PLANS_TOKEN, undefined, "external CLIs exclude unknown file-only injections too");
	});

	it("keyValue resolves env-first", () => {
		assert.equal(keyValue("OPENROUTER_API_KEY"), ENV_OWNED);
		assert.equal(keyValue("FUTURE_PLANS_TOKEN"), "opaque-plans-token");
		assert.equal(keyValue("BRAVE_API_KEY"), undefined);
	});
});



describe("retired provider ids", () => {
	it("are never present, so admission refuses them instead of failing in the catalog", () => {
		for (const id of ["chatgpt", "github-copilot-subscription", "xai-subscription", "custom"]) assert.equal(providerKeyPresent(id), false, id);
		assert.equal(providerKeyPresent("amazon-bedrock"), true, "registered providers without a plain key stay present");
	});
});

describe("key sync fast path", () => {
	it("still re-syncs after a real-env edit between lookups", () => {
		assert.equal(keyValue("OPENROUTER_API_KEY"), ENV_OWNED);
		process.env.OPENROUTER_API_KEY = "sk-or-v1-envedited00";
		assert.equal(keyValue("OPENROUTER_API_KEY"), "sk-or-v1-envedited00", "real env still wins after an edit");
		delete process.env.OPENROUTER_API_KEY;
		assert.equal(keyValue("OPENROUTER_API_KEY"), "sk-or-v1-filefilefile", "unsetting real env falls back to the config file");
		process.env.OPENROUTER_API_KEY = ENV_OWNED;
	});
});
