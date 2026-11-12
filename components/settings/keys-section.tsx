"use client";
/**
 * The Providers section: a READ-ONLY status table. Credentials are configured
 * on the server only (environment variables or the operator config file);
 * the browser never writes or receives them. Each row
 * shows a provider and its masked status; curated rows keep the tiny
 * "key ↗" docs link for the server operator.
 *
 * API: GET /api/keys (masked statuses + the providers array) and the model
 * catalog's server-managed provider rows. Plaintext never leaves the server.
 */

import { useEffect, useRef, useState } from "react";
import { AUTH_KEYS, type AuthKeyStatus, type AuthProviderInfo } from "@/src/core";
import { SettingsGroup } from "./controls.tsx";
import { ClaudeCodeInstallationStatus } from "./claude-code-status.tsx";
import { FOCUS_REFRESH_MS, useModelCatalog } from "@/components/model-catalog";

interface KeysResponse {
	keys: AuthKeyStatus[];
	providers?: AuthProviderInfo[];
	/** The config file's Claude Code opt-in. */
	claudeCode?: { enabled: boolean };
	/** Why the config file was ignored; absent when valid or missing. */
	configError?: string;
}

/** The curated tools group, pinned by id (the catalog owns the copy;
 *  these ids are the contract). Derived from core/auth-keys.ts. */
const TOOL_IDS = AUTH_KEYS.map((k) => k.id) as readonly string[];

/** The classification driving the table groups. Pure — exported for
 *  tests. */
export function classifyKeys(
	statuses: readonly AuthKeyStatus[],
	providers: readonly AuthProviderInfo[] | undefined,
): {
	/** Provider keys present on the server (env or file), in GET order. */
	providerRows: AuthKeyStatus[];
	/** The curated tools rows (synthesized when absent — always shown,
	 *  they carry the docs links a first boot needs). */
	toolRows: AuthKeyStatus[];
	/** Other server variables — listed, masked. */
	unknownRows: AuthKeyStatus[];
} {
	const byId = new Map(statuses.map((s) => [s.id, s]));
	const isTool = (id: string) => TOOL_IDS.includes(id);
	const providerEnv = new Set((providers ?? []).map((p) => p.envVar));
	const synth = (id: string): AuthKeyStatus => ({
		id,
		info: null,
		present: false,
		masked: null,
		source: "none",
		shadowedByEnv: false,
	});
	const providerRows: AuthKeyStatus[] = [];
	const unknownRows: AuthKeyStatus[] = [];
	for (const s of statuses) {
		if (isTool(s.id)) continue;
		if (providerEnv.has(s.id) || (!s.info && providers === undefined)) providerRows.push(s);
		else if (!s.info) unknownRows.push(s);
		else providerRows.push(s);
	}
	return {
		providerRows,
		toolRows: TOOL_IDS.map((id) => byId.get(id) ?? synth(id)),
		unknownRows,
	};
}

/** A key row names its credential, not whichever provider sorts first.
 * Pi exposes Zen and Go separately but both read OPENCODE_API_KEY. */
export function providerKeyLabel(id: string, providers: readonly AuthProviderInfo[] | undefined): string | undefined {
	const matches = providers?.filter((p) => p.envVar === id);
	if (matches?.some((p) => p.id === "opencode") && matches.some((p) => p.id === "opencode-go")) return "OpenCode (Zen / Go)";
	return matches?.[0]?.label;
}

/** The minimal status line, e.g. "…ab12 · 64 chars" (" · env" marks an
 *  environment-owned value). Pure. */
export function keyStatusLine(status: AuthKeyStatus): string {
	if (!status.present || !status.masked) return "not set";
	const tail = status.masked.replace(/ \((\d+) chars\)$/, "");
	const chars = status.masked.match(/\((\d+) chars\)$/)?.[1];
	if (!chars) return `${tail}${status.source === "env" ? " · env" : ""}`;
	return `${tail} · ${chars}${status.source === "env" ? " · env" : ""}`;
}

/** One read-only row: label left, tiny docs link + status right. */
function StatusTableRow({
	label,
	docsUrl,
	status,
	highlighted,
	testid,
}: {
	label: string;
	docsUrl?: string;
	status: string;
	highlighted?: boolean;
	testid: string;
}) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (highlighted) ref.current?.scrollIntoView({ block: "nearest" });
	}, [highlighted]);
	return (
		<div
			ref={ref}
			data-testid={testid}
			data-highlighted={highlighted ? "true" : undefined}
			className={`flex w-full items-center justify-between gap-3 rounded-sm px-1 py-1.5 ${highlighted ? "bg-accent/50" : ""}`}
		>
			<span className="min-w-0 truncate font-ui text-xs text-foreground">{label}</span>
			<span className="flex shrink-0 items-center gap-2">
				{docsUrl && (
					<a
						href={docsUrl}
						target="_blank"
						rel="noreferrer"
						className="text-[10px] text-muted-foreground/60 underline-offset-2 hover:text-foreground hover:underline"
					>
						key ↗
					</a>
				)}
				<span data-testid={`${testid}-status`} className="font-mono text-[11px] text-muted-foreground">
					{status}
				</span>
			</span>
		</div>
	);
}

export function KeysSection({
	/** A deep-linked row to highlight on arrival (zero-keys wave). */
	initialRow,
}: {
	initialRow?: string;
}) {
	const [statuses, setStatuses] = useState<AuthKeyStatus[] | null>(null);
	const [providers, setProviders] = useState<AuthProviderInfo[] | undefined>(undefined);
	const [configError, setConfigError] = useState<string | undefined>(undefined);
	const [claudeCodeEnabled, setClaudeCodeEnabled] = useState<boolean | undefined>(undefined);
	const { catalog } = useModelCatalog();
	const serverProviders = catalog?.providers.filter((provider) => provider.serverManaged) ?? [];

	useEffect(() => {
		let active = true;
		let last = 0;
		const load = () => {
			last = Date.now();
			void fetch("/api/keys", { cache: "no-store" })
				.then((r) => r.json() as Promise<KeysResponse>)
				.then((body) => {
					if (!active) return;
					setStatuses(body.keys ?? []);
					if (body.providers) setProviders(body.providers);
					setConfigError(body.configError);
					setClaudeCodeEnabled(body.claudeCode?.enabled === true);
				})
				.catch(() => { if (active) setStatuses((current) => current ?? []); });
		};
		// Keys are edited on the server: re-read on focus, throttled.
		const onFocus = () => { if (Date.now() - last >= FOCUS_REFRESH_MS) load(); };
		load();
		window.addEventListener("focus", onFocus);
		return () => { active = false; window.removeEventListener("focus", onFocus); };
	}, []);

	if (statuses === null) {
		return <p className="px-6 py-5 text-xs text-muted-foreground/70">Loading providers…</p>;
	}

	const { providerRows, toolRows, unknownRows } = classifyKeys(statuses, providers);

	return (
		<div className="contents">
			<p data-testid="providers-server-managed" className="px-1 pb-2 text-[11px] leading-relaxed text-muted-foreground/70">
				Provider keys are managed on the server, in its config file or environment. This page shows their status only.
			</p>
			{configError && (
				<p data-testid="config-file-error" role="alert" className="px-1 pb-2 text-xs text-destructive">
					Config file error: {configError}. The whole file is ignored until it is fixed.
				</p>
			)}
			<SettingsGroup label="Model API keys" testid="group-provider-keys">
				{providerRows.length === 0 && serverProviders.length === 0 && (
					<p data-testid="no-provider-keys" className="px-1 py-1.5 text-xs text-muted-foreground">No model provider is configured on the server.</p>
				)}
				{providerRows.map((status) => (
					<StatusTableRow
						key={status.id}
						label={providerKeyLabel(status.id, providers) ?? status.info?.label ?? status.id}
						docsUrl={status.info?.docsUrl}
						status={keyStatusLine(status)}
						highlighted={initialRow === status.id}
						testid={`key-${status.id.toLowerCase()}`}
					/>
				))}
				{serverProviders.map((provider) => (
					<StatusTableRow
						key={provider.id}
						label={provider.name ?? provider.id}
						status={provider.keyPresent ? "configured" : "missing credentials"}
						testid={`server-provider-${provider.id}`}
					/>
				))}
				{unknownRows.length > 0 && <div data-testid="group-unknown-keys">
					{unknownRows.map((status) => <div key={status.id} data-testid={`unknown-${status.id}`} className="flex items-center justify-between gap-3 px-1 py-1.5 opacity-40">
						<span className="font-mono text-xs text-foreground">{status.id}</span>
						<span className="font-mono text-[11px] text-muted-foreground">{status.masked}</span>
					</div>)}
				</div>}
			</SettingsGroup>

			<SettingsGroup label="External CLI" testid="group-external-cli">
				<ClaudeCodeInstallationStatus enabled={claudeCodeEnabled} />
			</SettingsGroup>

			<SettingsGroup label="Search" testid="group-search">
				{toolRows.map((status) => (
					<StatusTableRow
						key={status.id}
						label={status.info?.label ?? status.id}
						docsUrl={status.info?.docsUrl}
						status={keyStatusLine(status)}
						highlighted={initialRow === status.id}
						testid={`key-${status.id.toLowerCase()}`}
					/>
				))}
			</SettingsGroup>
		</div>
	);
}
