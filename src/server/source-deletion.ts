import { deleteSourcesTraces, pruneDetachedNodes } from "../core/graph-deletion.ts";
import { folderIsEmpty, type SourceDirectory } from "../core/source-organization.ts";
import { extractionStatuses } from "../agent/subagents/extraction.ts";
import { stores } from "./stores.ts";
import { sourceDirectory } from "./source-organization.ts";
import { deleteIdleChatRecord, runningWorkBlocker } from "./chats.ts";
import { graphRevision } from "./graph.ts";
import { VAULT_DIR } from "./vault-config.ts";

export class SourceDeletionError extends Error {
	constructor(message: string, public status = 400, public code = "invalid_source_deletion") { super(message); }
}
export interface SourceDeletionRequest { sourceIds: string[]; folderIds: string[]; deleteSessions: boolean }
export function parseSourceDeletion(raw: unknown): SourceDeletionRequest {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SourceDeletionError("Invalid source deletion request.");
	const r = raw as Record<string, unknown>;
	const ids = (value: unknown) => {
		if (!Array.isArray(value) || !value.every((id) => typeof id === "string" && id.length > 0)) throw new SourceDeletionError("Source and folder IDs must be arrays of non-empty strings.");
		return [...new Set(value)] as string[];
	};
	if (typeof r.deleteSessions !== "boolean") throw new SourceDeletionError("Session deletion must be explicitly selected or declined.");
	const result = { sourceIds: ids(r.sourceIds), folderIds: ids(r.folderIds), deleteSessions: r.deleteSessions };
	if (!result.sourceIds.length && !result.folderIds.length) throw new SourceDeletionError("Select at least one source or folder.");
	return result;
}

/** A single synchronous deletion stretch, after the same global extraction
 * refusal as the old chains-view deletion. No imports or turns are cancelled.
 * Missing entries are harmless on retry after a partially completed I/O failure. */
export function deleteSources(raw: unknown): SourceDirectory & { graphRevision: number } {
	const request = parseSourceDeletion(raw);
	const directory = sourceDirectory.read(); // validate organization before any destructive write
	const targets = directory.sources.filter((s) => request.sourceIds.includes(s.id));
	if (targets.length && extractionStatuses().length) throw new SourceDeletionError("An extraction is running — try again when the activity dock drains.", 409, "extraction_running");
	const records = stores.graphStore.readSources().filter((s) => request.sourceIds.includes(s.id));
	// Vault library: a followed note still in the vault would reappear on the
	// next scan and re-extract — the vault decides. Only a note gone from the
	// vault (missing, skip-listed or not) or on the skip list (both carry
	// missingSince) deletes here.
	const present = VAULT_DIR ? records.filter((s) => s.vault && !s.vault.missingSince) : [];
	if (present.length) {
		const one = present.length === 1;
		throw new SourceDeletionError(`${present.map((s) => s.vault!.path).join(", ")} ${one ? "is" : "are"} still in your vault. Delete ${one ? "it" : "them"} from the vault, or skip ${one ? "it" : "them"} in Settings → Library.`, 409, "vault_note_present");
	}
	if (request.deleteSessions) for (const entry of targets) if (entry.kind === "chat") {
		const blocker = runningWorkBlocker(entry.id);
		if (blocker) throw new SourceDeletionError(blocker.error, blocker.status, blocker.code);
	}
	// Clear the whole selected batch in one graph rewrite. Kept chats lose
	// coverage/checkpoints too, so their unchanged messages can be re-extracted.
	deleteSourcesTraces(stores.graphStore, new Set(targets.map((s) => s.id)), "delete-nodes");
	// After a failed re-extraction a vault note's old ideas are detached: no
	// provenance, listed only in vault.detached. Deleting the record would
	// orphan them forever, so prune them first.
	const pending = records.flatMap((s) => s.vault?.detached ?? []);
	if (pending.length) pruneDetachedNodes(stores.graphStore, new Set(pending));
	stores.graphStore.deleteSources(new Set(targets.filter((s) => s.kind === "notes").map((s) => s.id)));
	const removed = new Set(request.sourceIds.filter((id) => !directory.sources.some((s) => s.id === id)));
	for (const entry of targets) {
		if (entry.kind === "chat" && request.deleteSessions) {
			const outcome = deleteIdleChatRecord(entry.id);
			if (!outcome.ok) throw new SourceDeletionError(outcome.error, outcome.status, outcome.code);
			removed.add(entry.id);
		} else if (entry.kind !== "chat") removed.add(entry.id);
	}
	const state = structuredClone(directory.organization);
	state.placements = Object.fromEntries(Object.entries(state.placements).filter(([id]) => !removed.has(id)));
	const remainingSources = new Set(sourceDirectory.read().sources.map((s) => s.id));
	// Bottom-up fixed point: remove selected empty descendants, then their
	// emptied ancestors. Kept conversations and unselected entries block removal.
	let changed = true;
	while (changed) {
		changed = false;
		for (const id of request.folderIds) {
			if (state.folders.some((f) => f.id === id) && folderIsEmpty(state, id, remainingSources)) {
				state.folders = state.folders.filter((f) => f.id !== id);
				state.placements = Object.fromEntries(Object.entries(state.placements).filter(([, p]) => p.folderId !== id));
				changed = true;
			}
		}
	}
	if (JSON.stringify(state) !== JSON.stringify(directory.organization)) stores.sourceOrganizationStore.write(state);
	return { ...sourceDirectory.read(), graphRevision: graphRevision() };
}
