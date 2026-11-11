/**
 * The zero-keys wave's pure seams: the pill's SSR shape and the setup
 * dialog's server-configuration screen.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { strongKeyless, ZeroKeysPill } from "../components/setup-cta.tsx";
import type { ModelCatalogResponse } from "../src/core/index.ts";
import { SetupKeysBody } from "../components/setup-dialog.tsx";
import { DICTATION_KEYLESS, DEEPGRAM_KEY_ID } from "../components/dictation.tsx";

describe("ZeroKeysPill — the composer-hoisted notice", () => {
	it("the pill takes the CTA's chrome with its own testid and copy", () => {
		const html = renderToStaticMarkup(createElement(ZeroKeysPill, { onOpen: () => {} }));
		assert.ok(html.includes('data-testid="setup-cta-keys"'));
		assert.match(html, />Set up providers<\/button>/);
		assert.doesNotMatch(html, /chats start|—/);
		// the models CTA's testid must not appear on the keys pill
		assert.ok(!html.includes('data-testid="setup-cta"'));
	});
});

describe("SetupKeysBody — keys are server configuration", () => {
	it("explains the server-side setup and offers only a recheck", () => {
		const html = renderToStaticMarkup(createElement(SetupKeysBody, { onCheck: () => {} }));
		assert.ok(html.includes('data-testid="setup-check-again"'));
		assert.match(html, /server environment/);
		assert.ok(!html.includes('data-testid="setup-key-input"'), "no key entry in the browser");
	});
});

describe("the dictation keyless seam (owner dictation trio)", () => {
	it("the client-authored short line — not the route's dev-speak", () => {
		assert.equal(DICTATION_KEYLESS, "Dictation needs a Deepgram key");
	});

	it("the Deepgram row id matches the keys store (KeysSection openRow)", () => {
		assert.equal(DEEPGRAM_KEY_ID, "DEEPGRAM_API_KEY");
	});
});
/** A minimal catalog double — only the two halves the strong-keyless guard
 *  reads: the strong pin and the present-key providers list. */
const catalog = (strongProvider: string | null, ...keyedProviders: string[]): ModelCatalogResponse => ({
	models: [],
	defaults: null,
	rolePins: {
		researcher: null,
		demoBuilder: null,
		visualMaker: null,
		extractor: null,
		auditor: null,
		sideQuestion: null,
	},
	slots: {
		strong: strongProvider
			? { model: { provider: strongProvider, id: `${strongProvider}/model` }, thinkingLevel: "low" }
			: null,
		cheap: null,
		vision: null,
	},
	providers: keyedProviders.map((id) => ({ id, envVar: `${id.toUpperCase()}_API_KEY`, keyPresent: true })),
});

describe("strongKeyless — the pre-send guard's truth (owner interlude, no-orphan-chats)", () => {
	it("strong pinned to a provider whose key is gone: the guard FIRES", () => {
		// keys exist generally (anthropic), but the strong slot pins openrouter
		assert.equal(strongKeyless(catalog("openrouter", "anthropic")), true);
		// no keys at all with a strong pin: also keyless (guard case 1 fires too)
		assert.equal(strongKeyless(catalog("openrouter")), true);
	});

	it("strong provider's key present: the guard does NOT fire — the normal send path stays open", () => {
		assert.equal(strongKeyless(catalog("openrouter", "openrouter", "anthropic")), false);
		// belt check: a provider row never counts when keyPresent is false
		const lying = catalog("openrouter", "openrouter", "anthropic");
		lying.providers[0]!.keyPresent = false;
		assert.equal(strongKeyless(lying), true);
	});

	it("no strong pin (the models guard owns that case) or catalog not loaded: false — the server gate remains the belt", () => {
		assert.equal(strongKeyless(catalog(null, "openrouter")), false);
		assert.equal(strongKeyless(undefined), false);
	});
});
