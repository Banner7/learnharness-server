import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, it } from "node:test";
import type { GraphChain, GraphNode } from "../src/core/index.ts";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-vault-reextract-"));
const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-vault-dir-"));
process.env.LH_DATA_DIR = root; process.env.LH_AUTH_FILE = path.join(root, "auth.json"); process.env.LH_VAULT_DIR = vaultDir;
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}\n");
const { stores } = await import("../src/server/stores.ts");
const { getGraph } = await import("../src/core/graph.ts");
const { detachSourceTraces, pruneDetachedNodes } = await import("../src/core/graph-deletion.ts");
const { DELETE } = await import("../app/api/graph/sources/route.ts");
const { DELETE: deleteMissing } = await import("../app/api/library/missing/route.ts");
const { vaultEntryState } = await import("../src/core/vault-sync.ts");
const { writeSettings } = await import("../src/store/settings.ts");
beforeEach(() => { fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(root); fs.writeFileSync(process.env.LH_AUTH_FILE!, "{}\n"); });
after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(vaultDir, { recursive: true, force: true }); });

const node = (id: string, sources: string[]): GraphNode =>
	({ id, name: id, statement: `${id} statement`, aliases: [], createdAt: "2026-11-01", provenance: sources.map((chatId) => ({ chatId, messageId: "" })) });
const chain = (id: string, premises: string[], conclusion: string, sources: string[]): GraphChain =>
	({ id, premises, conclusion, createdAt: "2026-11-01", provenance: sources.map((chatId) => ({ chatId, messageId: "" })) });
const ids = () => new Set(getGraph(stores.graphStore).nodes.map((n) => n.id));

it("re-extraction keeps re-linked ideas on their ids, prunes only unsupported ones, spares other sources", () => {
	for (const n of [node("kept", ["src_v"]), node("stale", ["src_v"]), node("shared", ["src_v", "chat_1"]), node("other", ["chat_1"])]) stores.graphStore.appendNode(n);
	stores.graphStore.appendChain(chain("arg_v", ["kept"], "stale", ["src_v"]));
	stores.graphStore.appendChain(chain("arg_c", ["shared"], "other", ["chat_1"]));

	const candidates = detachSourceTraces(stores.graphStore, "src_v");
	assert.deepEqual([...candidates].sort(), ["kept", "stale"], "a node another source backs is never a candidate");
	assert.deepEqual([...ids()].sort(), ["kept", "other", "shared", "stale"], "detach deletes no node");
	assert.ok(!stores.graphStore.readChains().some((c) => c.id === "arg_v"), "the note's own assertion is dropped for re-assertion");

	// The re-run's auditor links the unchanged idea back (a link line).
	stores.graphStore.appendNode(node("kept", ["src_v"]));
	assert.equal(pruneDetachedNodes(stores.graphStore, candidates), 1);
	assert.deepEqual([...ids()].sort(), ["kept", "other", "shared"]);
	assert.ok(stores.graphStore.readChains().some((c) => c.id === "arg_c"), "other sources' chains survive");
	const shared = getGraph(stores.graphStore).nodes.find((n) => n.id === "shared")!;
	assert.deepEqual(shared.provenance.map((p) => p.chatId), ["chat_1"]);
});

it("a candidate a concurrent chat extraction re-links survives the prune", () => {
	stores.graphStore.appendNode(node("idea", ["src_v"]));
	const candidates = detachSourceTraces(stores.graphStore, "src_v");
	stores.graphStore.appendNode(node("idea", ["chat_2"]));
	assert.equal(pruneDetachedNodes(stores.graphStore, candidates), 0);
	assert.ok(ids().has("idea"));
});

const removeSources = (sourceIds: string[]) => DELETE(new Request("http://localhost/api/graph/sources", { method: "DELETE", body: JSON.stringify({ sourceIds, folderIds: [], deleteSessions: false }) }));
const removeMissing = (ids: string[]) => deleteMissing(new Request("http://localhost/api/library/missing", { method: "DELETE", body: JSON.stringify({ ids }) }));
const notePath = path.join(vaultDir, "math", "Note.md");
const putNote = () => { fs.mkdirSync(path.dirname(notePath), { recursive: true }); fs.writeFileSync(notePath, "# Note\n"); };
const vault = (missingSince?: string) => ({ path: "math/Note.md", contentHash: "h", changedAt: "2026-11-01", extractedHash: "h", ...(missingSince ? { missingSince } : {}) });

it("a vault note still in the vault cannot be deleted from LH; a missing one can, after review", async () => {
	putNote();
	stores.graphStore.upsertSource({ id: "src_v", filePath: "math/Note.md", importedAt: "2026-11-01", vault: vault() });
	stores.graphStore.appendNode(node("idea", ["src_v"]));
	assert.equal((await removeSources(["src_v"])).status, 409);
	assert.equal((await removeMissing(["src_v"])).status, 409);
	assert.ok(ids().has("idea"), "the refusals write nothing");

	fs.rmSync(notePath);
	assert.equal((await removeMissing(["src_v"])).status, 200, "the fresh scan confirms it is gone");
	assert.ok(!ids().has("idea"));
});

it("a skipped note still on disk is not 'missing': the review route refuses it", async () => {
	putNote();
	writeSettings({ version: 1, library: { exclude: ["math/"] } });
	stores.graphStore.upsertSource({ id: "src_v", filePath: "math/Note.md", importedAt: "2026-11-01", vault: vault("2026-11-02") });
	stores.graphStore.appendNode(node("idea2", ["src_v"]));
	assert.equal((await removeMissing(["src_v"])).status, 409);
	assert.ok(ids().has("idea2"));
	fs.rmSync(notePath);
});

it("a note restored on disk since the last scan is refused, not deleted", async () => {
	stores.graphStore.upsertSource({ id: "src_r", filePath: "math/Note.md", importedAt: "2026-11-01", vault: vault("2026-11-02") });
	stores.graphStore.appendNode(node("idea3", ["src_r"]));
	putNote();
	assert.equal((await removeMissing(["src_r"])).status, 409);
	assert.ok(ids().has("idea3"));
	fs.rmSync(notePath);
});

it("deleting a missing note prunes ideas left detached by a failed re-extraction", async () => {
	stores.graphStore.upsertSource({ id: "src_d", filePath: "math/Gone.md", importedAt: "2026-11-01",
		vault: { path: "math/Gone.md", contentHash: "h", changedAt: "2026-11-01", extractedHash: "h", missingSince: "2026-11-02", detached: ["orphan"] } });
	stores.graphStore.appendNode(node("orphan", []));
	assert.equal((await removeMissing(["src_d"])).status, 200);
	assert.ok(!ids().has("orphan"), "the detached idea is pruned, not orphaned");
});

it("a vanished note reads as skipped while its path is on the skip list, missing otherwise", () => {
	const source = { id: "src_s", filePath: "reading/Book.md", importedAt: "2026-11-01", vault: { path: "reading/Book.md", contentHash: "h", changedAt: "2026-11-01", extractedHash: "h", missingSince: "2026-11-02" } };
	assert.equal(vaultEntryState(source, false, ["reading/"]), "skipped");
	assert.equal(vaultEntryState(source, false, ["read"]), "missing", "a partial file pattern is not a folder prefix");
	assert.equal(vaultEntryState(source, false, []), "missing");
});
