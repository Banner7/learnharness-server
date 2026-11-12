"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CLAUDE_CODE_MINIMUM_VERSION, type ClaudeCodeStatus } from "@/src/core";
import { Button } from "@/components/ui/button";

export function claudeCodeStatusLabel(status: ClaudeCodeStatus | null): string {
	switch (status?.state) {
		case "not-found": return "Not found";
		case "meets-minimum": return `Version ${status.version} · meets minimum`;
		case "update-required": return `Version ${status.version} · update required`;
		default: return "Version could not be checked";
	}
}

/** `enabled` is the config file's opt-in, read by the Providers section
 *  from /api/keys (undefined until loaded). The app never changes it. */
export function ClaudeCodeInstallationStatus({ enabled: configured }: { enabled: boolean | undefined }) {
	const loaded = configured !== undefined;
	const enabled = configured === true;
	const [status, setStatus] = useState<ClaudeCodeStatus | null>(null);
	const [busy, setBusy] = useState(false);
	const request = useRef<AbortController | null>(null);

	const refresh = useCallback(async () => {
		if (!enabled) return;
		request.current?.abort();
		const controller = new AbortController();
		request.current = controller;
		setBusy(true);
		try {
			const response = await fetch("/api/claude-code", { cache: "no-store", signal: controller.signal, headers: { "x-learnharness-claude-code": "1" } });
			if (!response.ok) throw new Error("status unavailable");
			const value = await response.json() as ClaudeCodeStatus;
			if (!["not-found", "meets-minimum", "update-required", "version-unchecked"].includes(value.state)
				|| value.minimumVersion !== CLAUDE_CODE_MINIMUM_VERSION
				|| (value.version !== null && (typeof value.version !== "string" || !/^\d+\.\d+\.\d+$/.test(value.version)))) throw new Error("invalid status");
			if (!controller.signal.aborted) setStatus(value);
		} catch {
			if (!controller.signal.aborted) setStatus(null);
		} finally {
			if (!controller.signal.aborted) setBusy(false);
		}
	}, [enabled]);
	useEffect(() => {
		if (enabled) void refresh();
		else { request.current?.abort(); setStatus(null); setBusy(false); }
		return () => request.current?.abort();
	}, [enabled, refresh]);

	return <div className="space-y-2" data-testid="claude-code-installation">
		<div className="flex items-center gap-3">
			<span className="font-prose text-(length:--lh-prose-size) text-foreground">Claude Code</span>
			{loaded && <span role="status" className="text-xs text-muted-foreground" data-testid="claude-code-enabled">{enabled ? "Enabled on the server" : "Off"}</span>}
		</div>
		{loaded && !enabled && <p className="text-xs leading-relaxed text-muted-foreground">Claude Code is enabled in the server config file, not in the app. See docs/claude-code.md.</p>}
		{enabled && <>
			<div className="flex flex-wrap items-center gap-3">
				<span role="status" className="text-xs text-muted-foreground">{busy ? "Checking…" : claudeCodeStatusLabel(status)}</span>
				<Button type="button" size="xs" variant="outline" className="cursor-pointer disabled:cursor-not-allowed" disabled={busy} onClick={() => void refresh()} data-testid="claude-code-check-again">Check again</Button>
			</div>
			<p className="text-xs leading-relaxed text-muted-foreground"><strong className="font-medium">Claude Code runs on the server with the server&apos;s own sign-in.</strong> Select a Claude Code model here; LearnHarness starts it when needed.</p>
			<p className="text-xs leading-relaxed text-muted-foreground">Checks installation/version only—not authentication, model access, or quota. Claude Code controls billing. Requires v{CLAUDE_CODE_MINIMUM_VERSION}+. <a href="https://code.claude.com/docs/en/setup" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">Setup ↗</a></p>
			<p className="text-xs leading-relaxed text-muted-foreground">Verify AI claims independently—they may be inaccurate, incomplete, misleading, or outdated.</p>
		</>}
	</div>;
}
