import { inspectClaudeInstallation } from "../agent/claude-code/installation.ts";
import { initAuthEnv } from "./keys.ts";
import { claudeCodeEnabled } from "./claude-code-config.ts";

/** The Settings status seam: initialize provenance before any child env is copied. */
async function claudeCodeInstallationStatus() {
	initAuthEnv();
	return inspectClaudeInstallation();
}

/** Explicit same-origin browser intent on top of the access gate (which
 * already pins Host and Origin). No CORS grants. */
export async function claudeCodeInstallationResponse(
	request: Request,
	inspect = claudeCodeInstallationStatus,
	enabled = claudeCodeEnabled,
): Promise<Response> {
	const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
	if (request.method !== "GET"
		|| request.headers.get("x-learnharness-claude-code") !== "1"
		|| request.headers.get("sec-fetch-site") === "cross-site") {
		return Response.json({ error: "Claude Code checks require a same-origin LearnHarness request." }, { status: 403, headers });
	}
	if (!enabled()) return Response.json({ error: "Claude Code is disabled." }, { status: 403, headers });
	return Response.json(await inspect(), { headers });
}
