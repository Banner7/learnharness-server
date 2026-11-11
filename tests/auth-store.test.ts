/**
 * The AuthStore fs adapter (auth-keys wave, 2026-09-19) — flat {VAR: value}
 * map at config.AUTH_FILE, read-only since v0.1.0 (credentials are managed on
 * the server host). LH_AUTH_FILE is redirected to a fresh tmp dir BEFORE the
 * first config import (the seam is module-load-bound — data-dir-seam
 * precedent), so no hand-edited auth.json is ever touched.
 *
 * Pinning: absent/corrupt = {} ("no keys yet"); hand edits are read live;
 * non-string values are ignored.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-auth-store-"));
process.env.LH_AUTH_FILE = path.join(TMP, "auth.json");

// Import AFTER the env redirect — module-load-bound seam.
const { authStore } = await import("../src/store/auth.ts");
const { AUTH_FILE } = await import("../config.ts");

after(() => {
	fs.rmSync(TMP, { recursive: true, force: true });
});

describe("AuthStore adapter", () => {
	it("absent file = {} (the documented first-boot state), never throws", () => {
		assert.deepEqual(authStore.authVars(), {});
	});

	it("hand edits are read on the next access; non-string values are ignored", () => {
		fs.writeFileSync(AUTH_FILE, JSON.stringify({ OPENROUTER_API_KEY: "sk-or-v1-abc", N: 3 }));
		assert.deepEqual(authStore.authVars(), { OPENROUTER_API_KEY: "sk-or-v1-abc" });
		fs.writeFileSync(AUTH_FILE, JSON.stringify({ OPENROUTER_API_KEY: "sk-or-v1-new" }));
		assert.equal(authStore.authVars().OPENROUTER_API_KEY, "sk-or-v1-new");
	});

	it("corrupt/non-object file = {} — never throws, looks like first boot", () => {
		fs.writeFileSync(AUTH_FILE, "{not json");
		assert.deepEqual(authStore.authVars(), {});
		fs.writeFileSync(AUTH_FILE, JSON.stringify(["array"]));
		assert.deepEqual(authStore.authVars(), {});
	});
});
