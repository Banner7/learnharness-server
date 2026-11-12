/**
 * GET /api/chats/:id/coverage — the extraction-coverage block alone (the
 * chat header's ring and the sidebar block poll it every 2 s while a run is
 * in flight). Same shape as the full record's `coverage` field, without
 * shipping the transcript. Gated by proxy.ts like every other route.
 */
import { sessionCoverage } from "@/src/server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const coverage = sessionCoverage(id);
	if (!coverage) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json(coverage, { headers: { "Cache-Control": "private, no-store" } });
}
