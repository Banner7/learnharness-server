/**
 * PUT /api/library/settings — the `library` section of the settings record
 * (auto-extract switch + vault skip list), replace-whole like every settings
 * section: absent fields are absent overrides, so an absent `exclude` lets
 * the server's LH_VAULT_EXCLUDE seed apply. A changed skip list applies at
 * once: the write triggers a rescan.
 */
import { parseLibrarySettings } from "@/src/core";
import { libraryStatus, readSettingsRecord, syncVault, writeSettingsRecord } from "@/src/server";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
	const parsed = parseLibrarySettings(await request.json().catch(() => null));
	if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
	const record = readSettingsRecord() ?? { version: 1 };
	writeSettingsRecord({ ...record, library: parsed.settings });
	await syncVault().catch((err) => console.error("[vault] rescan after settings change failed:", err));
	return Response.json(libraryStatus());
}
