/**
 * The operator config file (v0.2.0): one read-only file for keys, custom
 * providers and Claude Code. LH_CONFIG_FILE is redirected BEFORE the first
 * config import (module-load-bound seam).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-config-store-"));
const FILE = path.join(TMP, "config.json");
process.env.LH_CONFIG_FILE = FILE;
const { configStore } = await import("../src/store/config.ts");

after(() => fs.rmSync(TMP, { recursive: true, force: true }));
let tick = 0;
const write = (value: unknown) => {
	fs.writeFileSync(FILE, typeof value === "string" ? value : JSON.stringify(value));
	// A distinct mtime per write so the stat cache sees every edit.
	const t = new Date(Date.UTC(2026, 0, 1) + ++tick * 1000);
	fs.utimesSync(FILE, t, t);
};
const quietly = <T>(fn: () => T): { result: T; logged: string[] } => {
	const logged: string[] = [];
	const original = console.error;
	console.error = (...args: unknown[]) => { logged.push(args.join(" ")); };
	try { return { result: fn(), logged }; } finally { console.error = original; }
};

describe("config store", () => {
	it("a missing file is an empty config without an error", () => {
		const loaded = configStore.read();
		assert.equal(loaded.error, undefined);
		assert.deepEqual(loaded.config.keys ?? {}, {});
	});

	it("edits are read on the next access, without a restart", () => {
		write({ version: 1, keys: { OPENROUTER_API_KEY: "sk-or-v1-abc" }, claudeCode: { enabled: true } });
		assert.equal(configStore.read().config.keys?.OPENROUTER_API_KEY, "sk-or-v1-abc");
		assert.equal(configStore.read().config.claudeCode?.enabled, true);
		write({ keys: { OPENROUTER_API_KEY: "sk-or-v1-new" } });
		assert.equal(configStore.read().config.keys?.OPENROUTER_API_KEY, "sk-or-v1-new");
		assert.notEqual(configStore.read().config.claudeCode?.enabled, true, "removing the section disables Claude Code");
	});

	it("an invalid file is ignored as a whole, and its error never echoes values", () => {
		const { logged } = quietly(() => {
			for (const bad of ["{not json", JSON.stringify(["array"]), JSON.stringify({ keys: { OPENROUTER_API_KEY: "sk-secret-value" }, unknownField: 1 })]) {
				write(bad);
				const loaded = configStore.read();
				assert.ok(loaded.error, bad);
				assert.deepEqual(loaded.config.keys ?? {}, {}, "nothing from an invalid file is used");
				assert.ok(!loaded.error!.includes("sk-secret-value"));
			}
		});
		assert.ok(logged.length >= 1 && logged.every((line) => !line.includes("sk-secret-value")));
	});

	it("duplicate custom provider ids are rejected", () => {
		const provider = { id: "local", baseUrl: "http://ollama:11434/v1", models: [{ id: "m", contextWindow: 8192, maxTokens: 1024 }] };
		quietly(() => write({ customProviders: [provider, provider] }));
		const { result } = quietly(() => configStore.read());
		assert.match(result.error ?? "", /local|duplicate/i);
	});
});
