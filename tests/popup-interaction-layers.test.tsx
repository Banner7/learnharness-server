import React, { act, useEffect, useRef, useState } from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { InteractionLayersProvider, useInteractionLayers, type InteractionLayersController } from "../components/interaction-layers.tsx";
import { HostDialog } from "../components/host-dialog.tsx";
import { MenuShell } from "../components/menu-shell.tsx";
import { usePopoverDismiss } from "../components/popover-dismiss.ts";
import { createPortal } from "react-dom";
import { installModalDom } from "./modal-dom.ts";
import { usePluginMenuDismiss } from "../components/plugin-model-picker.tsx";

async function withDom(run: (controller: () => InteractionLayersController, render: (node: React.ReactNode) => Promise<void>) => Promise<void>) {
	const dom = parseHTML("<html><body><div id='root'></div></body></html>");
	const values = { React, window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement,
		Element: dom.window.Element, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true,
		getSelection: () => ({ anchorNode: null, focusNode: null, anchorOffset: 0, focusOffset: 0 }) };
	const saved = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	Object.assign(globalThis, values);
	const restore = installModalDom(dom);
	Object.defineProperty(dom.document, "oninput", { configurable: true, value: null });
	const { createRoot } = await import("react-dom/client");
	let controller!: InteractionLayersController;
	function Probe({ children }: { children: React.ReactNode }) { controller = useInteractionLayers(); return children; }
	const root = createRoot(document.querySelector("#root")!);
	try {
		await run(() => controller, async node => {
			await act(async () => { root.render(<InteractionLayersProvider><Probe>{node}</Probe></InteractionLayersProvider>); });
		});
	} finally {
		await act(async () => { root.unmount(); await new Promise(resolve => setTimeout(resolve, 5)); });
		restore();
		for (const [key, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
		}
	}
}
const click = async (selector: string) => { await act(async () => { document.querySelector<HTMLButtonElement>(selector)!.click(); }); };
async function key(controller: InteractionLayersController, target: Element, value: string, shiftKey = false) {
	const event = new window.Event("keydown", { bubbles: true, cancelable: true });
	Object.assign(event, { key: value, shiftKey });
	await act(async () => {
		// linkedom does not implement the browser's window capture route.
		controller.captureKeyDown(event as KeyboardEvent);
		target.dispatchEvent(event);
	});
	return event;
}

function ModalMenu({ blocked = false, searchable = false }: { blocked?: boolean; searchable?: boolean }) {
	const [open, setOpen] = useState(true), [menu, setMenu] = useState(false), [edited, setEdited] = useState(true);
	const trigger = useRef<HTMLButtonElement>(null);
	const controller = useInteractionLayers();
	return <HostDialog open={open} onClose={() => { setOpen(false); return "closed"; }} aria-label="Parent" frame={<div data-testid="parent" />}>
		<h2>Parent</h2><button ref={trigger} data-testid="trigger" onClick={() => setMenu(true)}>Menu</button>
		{menu && <MenuShell anchorRef={trigger} testid="test-menu" preferredSide="down" menuClass="fixture-menu"
			onClose={() => { if (blocked) return "blocked"; setMenu(false); return "closed"; }}>
			{searchable && <input data-testid="search" onKeyDown={event => {
				if (event.key === "Escape" && edited) { controller.claimEscape(event); event.stopPropagation(); setEdited(false); }
			}} data-edited={edited} />}
			<button data-testid="first">First</button><button disabled>Disabled</button><button data-testid="last">Last</button>
		</MenuShell>}
	</HostDialog>;
}

test("popup is portaled into its modal host; focused leaf Escape precedes menu then parent", async () => withDom(async (controller, render) => {
	await render(<ModalMenu searchable />);
	await click('[data-testid="trigger"]');
	const menu = document.querySelector<HTMLElement>('[data-testid="test-menu"]')!;
	assert(menu.parentElement?.hasAttribute("data-interaction-popup-host"));
	assert(document.querySelector('[role="dialog"]')!.contains(menu));
	const search = document.querySelector<HTMLInputElement>('[data-testid="search"]')!;
	assert.equal(document.activeElement, search, "existing search autofocus survives owned portal placement");
	await key(controller(), search, "Escape");
	assert.equal(search.dataset.edited, "false");
	assert(document.querySelector('[data-testid="test-menu"]'));
	await key(controller(), search, "Escape");
	assert.equal(document.querySelector('[data-testid="test-menu"]'), null);
	assert(document.querySelector('[data-testid="parent"]'), "one physical Escape cannot dismiss the newly exposed modal");
	await key(controller(), document.querySelector('[data-testid="parent"]')!, "Escape");
	assert.equal(document.querySelector('[data-testid="parent"]'), null);
}));

test("popup keeps arrow wrapping and consumes blocked Escape without native Tab loops", async () => withDom(async (controller, render) => {
	await render(<ModalMenu blocked />);
	await click('[data-testid="trigger"]');
	const menu = document.querySelector<HTMLElement>('[data-testid="test-menu"]')!;
	assert.equal(document.activeElement, menu);
	await key(controller(), menu, "ArrowDown");
	assert.equal(document.activeElement, document.querySelector('[data-testid="first"]'));
	await key(controller(), document.activeElement!, "ArrowDown");
	assert.equal(document.activeElement, document.querySelector('[data-testid="last"]'));
	await key(controller(), document.activeElement!, "ArrowDown");
	assert.equal(document.activeElement, document.querySelector('[data-testid="first"]'));
	for (const shift of [false, true]) {
		const focused: Element | null = document.activeElement;
		const event = await key(controller(), focused!, "Tab", shift);
		assert.equal(event.defaultPrevented, true);
		assert.equal(document.activeElement, focused);
	}
	const escape = await key(controller(), menu, "Escape");
	assert.equal(escape.defaultPrevented, true);
	assert(document.querySelector('[data-testid="test-menu"]'));
	assert(document.querySelector('[data-testid="parent"]'));
}));

function NestedMenus() {
	const [outer, setOuter] = useState(false), [inner, setInner] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null), childTrigger = useRef<HTMLButtonElement>(null);
	return <HostDialog open onClose={() => "blocked"} aria-label="Nested menu parent">
		<h2>Nested menu parent</h2><button ref={trigger} data-testid="outer-trigger" onClick={() => setOuter(true)}>Outer</button>
		{outer && <MenuShell anchorRef={trigger} preferredSide="down" testid="outer-menu" menuClass="fixture"
			onClose={() => { setOuter(false); return "closed"; }}>
			<button ref={childTrigger} data-testid="inner-trigger" onClick={() => setInner(true)}>Inner</button>
			<button data-testid="outer-last">Outer last</button>
			{inner && <MenuShell anchorRef={childTrigger} preferredSide="down" testid="inner-menu" menuClass="fixture"
				onClose={() => { setInner(false); return "closed"; }}><button data-testid="inner-first">Inner first</button><button>Inner last</button></MenuShell>}
		</MenuShell>}
	</HostDialog>;
}

test("nested popups share the unclipped modal host, integer paint order, and one keyboard owner", async () => withDom(async (controller, render) => {
	await render(<NestedMenus />);
	await click('[data-testid="outer-trigger"]');
	await click('[data-testid="inner-trigger"]');
	const outer = document.querySelector<HTMLElement>('[data-testid="outer-menu"]')!;
	const inner = document.querySelector<HTMLElement>('[data-testid="inner-menu"]')!;
	assert.equal(inner.parentElement, outer.parentElement);
	assert(Number.isInteger(Number(inner.style.zIndex)));
	assert(Number(inner.style.zIndex) > Number(outer.style.zIndex));
	const modal = document.querySelector('[role="dialog"]')!;
	assert.equal(modal.getAttribute("aria-hidden"), null, "an owned popup never hides its modal parent");
	assert.equal(modal.hasAttribute("inert"), false);
	assert.equal(controller().isElementEligible(outer), false);
	await key(controller(), inner, "ArrowDown");
	assert.equal(document.activeElement, document.querySelector('[data-testid="inner-first"]'), "portaled React bubbling cannot also run the parent arrow machine");
	await key(controller(), inner, "Escape");
	assert.equal(document.querySelector('[data-testid="inner-menu"]'), null);
	assert(document.querySelector('[data-testid="outer-menu"]'));
	await key(controller(), outer, "Escape");
	assert.equal(document.querySelector('[data-testid="outer-menu"]'), null);
	assert(document.querySelector('[role="dialog"]'));
}));

function RepeatedPicker({ id }: { id: string }) {
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLDivElement>(null);
	// Like the real controls, open after the anchor exists. An initially open
	// child cannot measure a parent host ref before React attaches that ref.
	useEffect(() => { setOpen(true); }, []);
	const close = () => setOpen(false);
	usePluginMenuDismiss(open, root, close);
	return <div ref={root}><button>{id}</button>{open && <MenuShell anchorRef={root} testid="plugin-model-menu"
		preferredSide="up" menuClass="fixture" onClose={() => { close(); return "closed"; }}><button>{id} option</button></MenuShell>}</div>;
}

test("repeated plugin picker instances dismiss only the actual top panel on outside pointerdown", async () => withDom(async (_controller, render) => {
	await render(<><RepeatedPicker id="first" /><RepeatedPicker id="second" /></>);
	assert.equal(document.querySelectorAll('[data-testid="plugin-model-menu"]').length, 2);
	await act(async () => { document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true })); });
	const remaining = document.querySelectorAll('[data-testid="plugin-model-menu"]');
	assert.equal(remaining.length, 1);
	assert.equal(remaining[0]?.textContent, "first option", "do not use the first matching testid as the ownership proxy");
}));

function LegacyMetadata() {
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null);
	const controller = useInteractionLayers();
	usePopoverDismiss(root, open, () => setOpen(false), { layerRootRef: panel });
	return <div ref={root}><button data-testid="metadata-trigger" onClick={() => setOpen(true)}>Metadata</button>
		{open && createPortal(<div ref={panel} data-testid="metadata-panel">Existing panel</div>, controller.getPortalContainer(root.current)!)}
	</div>;
}

test("separate popup registration ref preserves legacy metadata outside-pointer policy", async () => withDom(async (_controller, render) => {
	await render(<LegacyMetadata />);
	await click('[data-testid="metadata-trigger"]');
	assert(document.querySelector('[data-testid="metadata-panel"]'));
	await act(async () => { document.querySelector('[data-testid="metadata-panel"]')!.dispatchEvent(new window.Event("pointerdown", { bubbles: true })); });
	assert.equal(document.querySelector('[data-testid="metadata-panel"]'), null, "do not silently fix the separately deferred metadata containment behavior");
}));
