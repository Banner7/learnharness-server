import React, { act } from "react";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { parseHTML } from "linkedom";
import { BROWSER_NOTICE, FilePathDropZone } from "../components/file-path-drop-zone.tsx";
import { PathInput } from "../components/path-input.tsx";

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

/** No native DataTransfer/Selection in linkedom. These shims exercise React's
 * real bubbling handlers, not OS drag. */
async function fixture({ onContentRoot }: {
	onContentRoot?: (element: HTMLElement | null) => void;
} = {}) {
	const { window: win, document: doc } = parseHTML("<html><body><div id='root'></div></body></html>");
	let active: Element = doc.body;
	Object.defineProperty(doc, "activeElement", { get: () => active });
	const selection = {
		anchorNode: null as Node | null, anchorOffset: 0, focusNode: null as Node | null, focusOffset: 0,
		setBaseAndExtent(anchorNode: Node, anchorOffset: number, focusNode: Node, focusOffset: number) {
			Object.assign(this, { anchorNode, anchorOffset, focusNode, focusOffset });
		},
	};
	Object.assign(doc, { getSelection: () => selection, oninput: null });
	win.HTMLElement.prototype.focus = function () { active = this; };
	let byteReads = 0;
	let uploads = 0;
	let submits = 0;
	let keys = 0;
	let value = "readthis";
	const previous = new Map<string, PropertyDescriptor | undefined>();
	for (const [name, next] of Object.entries({
		React, window: win, document: doc, Node: win.Node, HTMLElement: win.HTMLElement, Element: win.Element,
		Event: win.Event, CustomEvent: win.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true,
		fetch: () => { uploads++; throw new Error("No network expected for file drops"); },
	})) {
		previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
		Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: next });
	}
	const { createRoot } = await import("react-dom/client");
	const root = createRoot(doc.getElementById("root")!);
	function Harness() {
		return <>
			<aside data-testid="sidebar">Sidebar</aside>
			<FilePathDropZone onContentRoot={onContentRoot}>
				<form onSubmit={(event) => { event.preventDefault(); submits++; }}>
					<PathInput data-testid="editor" value={value} onValueChange={(next) => { value = next; draw(); }} onKeyDown={() => { keys++; }} />
					<button type="button" data-testid="elsewhere">Elsewhere</button>
					<div data-testid="content">Content away from the input</div>
				</form>
			</FilePathDropZone>
		</>;
	}
	function draw() { root.render(<Harness />); }
	await act(async () => { draw(); });
	cleanup = async () => {
		await act(async () => { root.unmount(); });
		for (const [name, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else delete (globalThis as Record<string, unknown>)[name];
		}
	};
	function file(name: string) {
		const result = new File(["synthetic bytes must never be read"], name, { type: "application/pdf" });
		for (const method of ["text", "arrayBuffer", "stream"] as const) {
			Object.defineProperty(result, method, { value: () => { byteReads++; throw new Error("No file content reads"); } });
		}
		return result;
	}
	function transfer(files: File[], types = ["Files"]) {
		return {
			types,
			files: Object.assign([...files], { item: (index: number) => files[index] ?? null }),
			items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
			dropEffect: "none",
		};
	}
	async function event(type: string, dataTransfer = transfer([]), target: Element = doc.querySelector('[data-testid="content"]')!) {
		const event = Object.assign(new win.Event(type, { bubbles: true, cancelable: true }), { dataTransfer });
		await act(async () => { target.dispatchEvent(event); });
		return event;
	}
	return {
		doc, file, transfer, event,
		get value() { return value; },
		get status() { return doc.querySelector('[role="status"]')?.textContent ?? ""; },
		assertPathOnly() { assert.equal(byteReads, 0); assert.equal(uploads, 0); assert.equal(submits, 0); assert.equal(keys, 0); },
	};
}

test("a device file drop prevents navigation, explains server paths and never infers File.name", async () => {
	const f = await fixture();
	const transfer = f.transfer([f.file("/not/a/backing/path.pdf")]);
	const enter = await f.event("dragenter", transfer);
	assert.equal(enter.defaultPrevented, true);
	assert.ok(f.doc.querySelector('[data-testid="file-path-drop-indicator"]'));
	const over = await f.event("dragover", transfer);
	assert.equal(over.defaultPrevented, true);
	assert.equal(transfer.dropEffect, "copy");
	const drop = await f.event("drop", transfer);
	assert.equal(drop.defaultPrevented, true);
	assert.equal(f.status, BROWSER_NOTICE);
	assert.equal(f.doc.querySelector('[data-testid="file-path-drop-indicator"]'), null);
	assert.equal(f.value, "readthis");
	f.assertPathOnly();
});

test("non-file drags stay native; sidebar file drops prevent navigation without attaching", async () => {
	const f = await fixture();
	const plain = f.transfer([], ["text/plain"]);
	for (const type of ["dragenter", "dragover", "drop"]) {
		assert.equal((await f.event(type, plain)).defaultPrevented, false);
	}
	const sidebar = f.doc.querySelector('[data-testid="sidebar"]')!;
	assert.equal((await f.event("drop", f.transfer([f.file("notes.pdf")]), sidebar)).defaultPrevented, true);
	assert.equal(f.status, "");
	f.assertPathOnly();
});

test("nested enter/leave depth keeps the drop overlay until the zone is left; notice is dismissible", async () => {
	const f = await fixture();
	const transfer = f.transfer([f.file("notes.pdf")]);
	await f.event("dragenter", transfer);
	await f.event("dragenter", transfer);
	await f.event("dragleave", transfer);
	assert.ok(f.doc.querySelector('[data-testid="file-path-drop-indicator"]'));
	await f.event("dragleave", transfer);
	assert.equal(f.doc.querySelector('[data-testid="file-path-drop-indicator"]'), null);
	await f.event("drop", transfer);
	assert.notEqual(f.status, "");
	await act(async () => { f.doc.querySelector<HTMLElement>('[aria-label="Dismiss attachment notice"]')!.click(); });
	assert.equal(f.status, "");
	f.assertPathOnly();
});

test("the host content root reports the real main column and clears on unmount", async () => {
	const seen: (HTMLElement | null)[] = [];
	const f = await fixture({ onContentRoot: (element) => { seen.push(element); } });
	const main = f.doc.querySelector<HTMLElement>("main")!;
	assert.equal(seen.length, 1);
	assert.equal(seen[0], main);
	assert.equal(main.contains(f.doc.querySelector('[data-testid="sidebar"]')), false);
	await cleanup!();
	cleanup = undefined;
	assert.deepEqual(seen, [main, null]);
});
