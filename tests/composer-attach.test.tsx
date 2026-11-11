/**
 * The composer's attach button (issue #285). The server build cannot read
 * files from the learner's device, so the paperclip is inert: no file input
 * exists and the tooltip explains how to attach a server path.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Composer } from "../components/composer.tsx";
import { InteractionLayersProvider } from "../components/interaction-layers.tsx";

it("an inert paperclip sits between the input and Send, with no file picker", () => {
	const html = renderToStaticMarkup(
		<InteractionLayersProvider>
			<Composer busy={false} value="" onChange={() => {}} onSend={() => {}} onStop={() => {}} canSend />
		</InteractionLayersProvider>,
	);
	const editor = html.indexOf("data-file-path-input");
	const attach = html.indexOf('data-testid="attach-files"');
	const send = html.indexOf('aria-label="Send"');
	assert.ok(editor >= 0 && editor < attach && attach < send, "the paperclip follows the input and precedes Send");
	assert.match(html.slice(html.lastIndexOf("<", attach), html.indexOf(">", attach)), /aria-disabled="true"/);
	assert.ok(!html.includes('type="file"'), "no device file picker");
});
