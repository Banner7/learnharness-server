import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampDragged, fitResizableSideThreadFrame, placeSideThread, resizeSideThread, SIDE_THREAD_MIN_HEIGHT, SIDE_THREAD_WIDTH, type SideThreadResizeEdge } from "../components/side-thread-float.ts";

const viewport = { width: 1400, height: 900 };

describe("placeSideThread", () => {
	it("sits right above a composer anchor at its exact width", () => {
		const p = placeSideThread({ kind: "composer", rect: { left: 492, right: 1196, top: 790, bottom: 845 }, viewport, contentHeight: 300 });
		assert.deepEqual(p.style, { left: 492, width: 704, bottom: 900 - 790 + 8 });
		assert.equal(p.maxHeight, Math.min(0.6 * 900, 790 - 8 - 8));
	});

	it("opens below a passage, and flips above when the content no longer fits below", () => {
		const rect = { left: 900, right: 1300, top: 520, bottom: 545 };
		const small = placeSideThread({ kind: "rect", rect, viewport, contentHeight: 200 });
		assert.equal(small.style.top, 545 + 4);
		assert.equal(small.style.width, SIDE_THREAD_WIDTH);
		const grown = placeSideThread({ kind: "rect", rect, viewport, contentHeight: 500 });
		assert.equal(grown.style.top, undefined);
		assert.equal(grown.style.bottom, 900 - 520 + 4);
	});

	it("keeps a narrow window's popover inside it", () => {
		const p = placeSideThread({ kind: "rect", rect: { left: 10, right: 50, top: 100, bottom: 120 }, viewport: { width: 300, height: 900 }, contentHeight: 100 });
		assert.equal(p.style.width, 300 - 16);
	});
});

describe("clampDragged", () => {
	it("keeps a dragged popover fully inside the window", () => {
		assert.deepEqual(clampDragged({ x: -50, y: -20 }, { width: 416, height: 300 }, viewport), { x: 8, y: 8 });
		assert.deepEqual(clampDragged({ x: 1300, y: 800 }, { width: 416, height: 300 }, viewport), { x: 1400 - 416 - 8, y: 900 - 300 - 8 });
		assert.deepEqual(clampDragged({ x: 200, y: 150 }, { width: 416, height: 300 }, viewport), { x: 200, y: 150 });
	});
});

describe("eight-edge/corner resizing", () => {
	const frame = { x: 400, y: 300, width: 600, height: 300 };
	it("keeps the opposite edge fixed for every handle", () => {
		for (const edge of ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as SideThreadResizeEdge[]) {
			const next = resizeSideThread(frame, edge, { x: 40, y: 30 }, viewport);
			assert.equal(next.x, edge.includes("w") ? 440 : 400, edge);
			assert.equal(next.y, edge.includes("n") ? 330 : 300, edge);
			assert.equal(next.width, edge.includes("w") ? 560 : edge.includes("e") ? 640 : 600, edge);
			assert.equal(next.height, edge.includes("n") ? 270 : edge.includes("s") ? 330 : 300, edge);
		}
	});
	it("retains the default width and vertical minimum, with viewport bounds winning", () => {
		assert.equal(resizeSideThread(frame, "e", { x: -2000, y: 0 }, viewport).width, SIDE_THREAD_WIDTH);
		const west = resizeSideThread(frame, "w", { x: 2000, y: 0 }, viewport);
		assert.equal(west.width, SIDE_THREAD_WIDTH); assert.equal(west.x + west.width, frame.x + frame.width);
		assert.equal(resizeSideThread(frame, "s", { x: 0, y: -2000 }, viewport).height, SIDE_THREAD_MIN_HEIGHT);
		assert.equal(resizeSideThread(frame, "s", { x: 0, y: 2000 }, viewport).height, 900 - 300 - 8);
		assert.equal(resizeSideThread(frame, "n", { x: 0, y: 2000 }, viewport).height, SIDE_THREAD_MIN_HEIGHT);
		assert.equal(resizeSideThread({ ...frame, height: 100 }, "e", { x: 100, y: 0 }, viewport).height, 100, "horizontal changes don't force a taller composer");
		const tiny = fitResizableSideThreadFrame(frame, { width: 300, height: 100 });
		assert.equal(tiny.width, 284); assert.equal(tiny.height, 84);
	});
	it("bounds all eight handles at extreme pointer positions and window widths", () => {
		for (const windowWidth of [300, 800, 1400]) {
			const vp = { width: windowWidth, height: 300 };
			for (const edge of ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as SideThreadResizeEdge[]) for (const travel of [{ x: -5000, y: -5000 }, { x: 5000, y: 5000 }]) {
				const next = resizeSideThread(frame, edge, travel, vp);
				assert.ok(next.width >= Math.min(SIDE_THREAD_WIDTH, vp.width - 16));
				assert.ok(next.x >= 8 && next.y >= 8);
				assert.ok(next.x + next.width <= vp.width - 8); assert.ok(next.y + next.height <= vp.height - 8);
			}
		}
	});
	it("keeps a chosen width on subsequent drag/fit operations", () => {
		const wide = resizeSideThread(frame, "w", { x: -250, y: 0 }, viewport);
		assert.equal(wide.width, 850);
		assert.equal(fitResizableSideThreadFrame({ ...wide, x: 700 }, viewport).width, 850);
	});
});
