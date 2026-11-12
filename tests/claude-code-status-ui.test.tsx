import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { ClaudeCodeInstallationStatus, claudeCodeStatusLabel } from "../components/settings/claude-code-status.tsx";
import type { ClaudeCodeStatus } from "../src/core/contracts/claude-code.ts";

// Claude Code is enabled in the server config file, never from the app: the
// panel shows the flag it is given and, when on, checks the installation.
const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement,
	CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });
const originalFetch = globalThis.fetch;
let root: Root | undefined, host: HTMLDivElement | undefined;
const status = (state: ClaudeCodeStatus["state"], version: string | null = null): ClaudeCodeStatus => ({ state, version, minimumVersion: "2.1.259" });
const button = () => document.querySelector<HTMLButtonElement>('[data-testid="claude-code-check-again"]');
const statusLines = () => [...document.querySelectorAll('[role="status"]')].map((node) => node.textContent);

let enabledFlag = false;
function fixture(probe: () => Promise<Response>, enabled: boolean) {
	enabledFlag = enabled;
	const calls: string[] = [];
	globalThis.fetch = (async (url, init) => {
		calls.push(`${init?.method ?? "GET"} ${url}`);
		assert.equal(url, "/api/claude-code");
		assert.equal(init?.cache, "no-store");
		assert.equal(new Headers(init?.headers).get("x-learnharness-claude-code"), "1");
		return probe();
	}) as typeof fetch;
	return calls;
}
async function mount() {
	host = document.createElement("div"); document.body.append(host); root = createRoot(host);
	await act(async () => root!.render(<ClaudeCodeInstallationStatus enabled={enabledFlag} />));
}
afterEach(async () => {
	await act(async () => root?.unmount()); host?.remove(); root = undefined; host = undefined;
	globalThis.fetch = originalFetch;
});

test("off on the server: explains server-side enablement and never probes", async () => {
	const calls = fixture(async () => assert.fail("must not probe"), false);
	await mount();
	assert.deepEqual(statusLines(), ["Off"]);
	assert.match(host!.textContent!, /enabled in the server config file, not in the app/);
	assert.equal(button(), null);
	assert.deepEqual(calls, []);
});

test("on the server: checks once on mount, and Check again re-probes", async () => {
	const calls = fixture(async () => Response.json(status("meets-minimum", "2.1.312")), true);
	await mount();
	assert.deepEqual(statusLines(), ["Enabled on the server", claudeCodeStatusLabel(status("meets-minimum", "2.1.312"))]);
	assert.equal(calls.filter((call) => call === "GET /api/claude-code").length, 1);
	await act(async () => button()!.click());
	assert.equal(calls.filter((call) => call === "GET /api/claude-code").length, 2);
});

for (const [name, response] of [
	["network", () => Promise.reject(new Error("offline"))],
	["http", async () => new Response(null, { status: 500 })],
	["payload", async () => Response.json({ state: "meets-minimum", version: "bogus", minimumVersion: "2.1.259" })],
] as const) test(`${name} failure never retains a stale meets-minimum status`, async () => {
	let fail = false;
	fixture(() => fail ? response() : Promise.resolve(Response.json(status("meets-minimum", "2.1.312"))), true);
	await mount();
	assert.equal(statusLines()[1], claudeCodeStatusLabel(status("meets-minimum", "2.1.312")));
	fail = true;
	await act(async () => button()!.click());
	assert.equal(statusLines()[1], claudeCodeStatusLabel(null));
});
