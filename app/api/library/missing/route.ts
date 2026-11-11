/**
 * /api/library/missing — review notes gone from the vault. GET lists them
 * with their graph impact; DELETE `{ ids }` removes the reviewed ones (their
 * records, placements and the ideas only they supported). A missing note is
 * never deleted without this explicit step: a sync accident must not wipe
 * ideas on its own.
 */
import { deleteMissingVaultNotes, missingVaultNotes, SourceDeletionError } from "@/src/server";
import { emit } from "@/src/core";

export const dynamic = "force-dynamic";

export function GET() {
	return Response.json({ notes: missingVaultNotes() });
}

export async function DELETE(request: Request) {
	const body = await request.json().catch(() => null) as { ids?: unknown } | null;
	const ids = body?.ids;
	if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1000 || !ids.every((id) => typeof id === "string" && id.length > 0)) {
		return Response.json({ error: "ids must be a non-empty list of source IDs." }, { status: 400 });
	}
	try {
		return Response.json({ notes: deleteMissingVaultNotes([...new Set(ids as string[])]) });
	} catch (error) {
		if (error instanceof SourceDeletionError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
		console.error("[vault] missing-note deletion failed:", error);
		return Response.json({ error: "Could not finish the deletion. Some notes may already have been removed; refresh or retry." }, { status: 500 });
	} finally {
		emit("sources-changed", {}); emit("activity-changed", {});
	}
}
