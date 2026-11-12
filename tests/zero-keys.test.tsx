/**
 * The zero-keys wave's pure seams: the pill's SSR shape and the setup
 * dialog's server-configuration screen.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ZeroKeysPill } from "../components/setup-cta.tsx";
import { SetupKeysBody } from "../components/setup-dialog.tsx";

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
	});
});
