"use client";
/**
 * Settings → Library: the vault library's one surface. The server follows a
 * folder of Markdown notes (LH_VAULT_DIR); this section shows what it
 * follows, starts Sync now, holds the auto-extract switch and the skip list,
 * and reviews notes gone from the vault before their ideas are deleted.
 * Self-contained: it reads and writes /api/library* on its own, so the
 * dialog only mounts it inside a SettingsSection.
 */

import { useCallback, useEffect, useState } from "react";
import type { LibrarySettings, LibraryStatus, MissingVaultNote } from "@/src/core";
import { Button } from "@/components/ui/button";
import { useServerEvent } from "@/components/server-events";
import { SettingsGroup, SettingsRow, Toggle } from "./controls.tsx";

async function readError(response: Response | null, fallback: string): Promise<string> {
	const body = await response?.json().catch(() => null) as { error?: string } | null;
	return body?.error ?? fallback;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function LibrarySection() {
	const [status, setStatus] = useState<LibraryStatus | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const [missing, setMissing] = useState<MissingVaultNote[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [confirming, setConfirming] = useState<string | null>(null);
	const [deleting, setDeleting] = useState(false);

	const refresh = useCallback(async () => {
		const response = await fetch("/api/library", { cache: "no-store" }).catch(() => null);
		if (!response?.ok) { setLoadFailed(true); return; }
		const next = await response.json() as LibraryStatus;
		setLoadFailed(false);
		setStatus(next);
		if (next.missing === 0) { setMissing([]); return; }
		const list = await fetch("/api/library/missing", { cache: "no-store" }).catch(() => null);
		if (list?.ok) setMissing((await list.json() as { notes: MissingVaultNote[] }).notes);
	}, []);
	useEffect(() => { void refresh(); }, [refresh]);
	useServerEvent("sources-changed", () => { void refresh(); });

	const syncNow = async () => {
		setError(null);
		const response = await fetch("/api/library", { method: "POST" }).catch(() => null);
		if (!response?.ok) setError(await readError(response, "Could not start the sync."));
		else setStatus(await response.json() as LibraryStatus);
	};

	const save = async (next: LibrarySettings) => {
		setError(null);
		const response = await fetch("/api/library/settings", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(next),
		}).catch(() => null);
		if (!response?.ok) setError(await readError(response, "Could not save library settings."));
		else setStatus(await response.json() as LibraryStatus);
	};

	const deleteMissing = async (ids: string[]) => {
		setError(null);
		setDeleting(true);
		try {
			const response = await fetch("/api/library/missing", {
				method: "DELETE",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ids }),
			}).catch(() => null);
			if (!response?.ok) setError(await readError(response, "Could not delete the notes."));
			else setMissing((await response.json() as { notes: MissingVaultNote[] }).notes);
		} finally {
			setDeleting(false);
			setConfirming(null);
			void refresh();
		}
	};

	if (!status) {
		return <p role="status" className="text-xs text-muted-foreground">{loadFailed ? "Library status could not be loaded." : "Loading…"}</p>;
	}
	if (!status.enabled) {
		return <p className="text-xs text-muted-foreground" data-testid="library-disabled">No vault folder is configured on the server (LH_VAULT_DIR).</p>;
	}
	const busy = status.draining || status.extracting !== null;
	const counts = [plural(status.notes, "note")];
	if (status.waiting) counts.push(`${status.waiting} waiting`);
	if (status.missing) counts.push(`${status.missing} missing`);
	if (status.skipped) counts.push(`${status.skipped} skipped`);

	return (
		<>
			<SettingsRow label="Vault" hint={status.extracting ? `Extracting ${status.extracting}` : counts.join(" · ")} testid="library-row-status">
				<Button type="button" size="xs" variant="outline" className="cursor-pointer disabled:cursor-not-allowed"
					data-testid="library-sync" disabled={busy || status.waiting === 0} onClick={() => void syncNow()}>
					{busy ? "Syncing…" : "Sync now"}
				</Button>
			</SettingsRow>
			{status.blocked && <p role="alert" className="text-xs text-error">Sync stopped: {status.blocked}</p>}
			{error && <p role="alert" className="text-xs text-error">{error}</p>}
			<SettingsRow label="Auto-extract" hint="After 5 quiet minutes on a note" testid="library-row-auto">
				{/* Spread the SAVED section, not the displayed list: an unsaved
				    skip list stays absent so the server's seed still applies. */}
				<Toggle checked={status.autoExtract} label="auto-extract vault notes"
					onChange={(on) => void save({ ...status.saved, autoExtract: on })} />
			</SettingsRow>
			<SkipList key={status.exclude.join("\n")} exclude={status.exclude} skipped={status.skipped}
				onCommit={(exclude) => void save({ ...status.saved, exclude })} />
			{missing.length > 0 && (
				<SettingsGroup label="Missing from the vault">
					<p className="text-xs text-muted-foreground">
						These notes are gone from the vault. Their ideas stay until you delete them here; ideas other sources also support are kept.
					</p>
					<ul className="flex flex-col gap-2" data-testid="library-missing">
						{missing.map((note) => (
							<li key={note.id} className="flex items-center justify-between gap-3" data-testid="library-missing-note">
								<span className="min-w-0">
									<span className="block truncate font-ui text-xs text-foreground" title={note.path}>{note.path}</span>
									<span className="block text-xs text-muted-foreground/70">
										{plural(note.ideas, "idea")}, {note.onlyFromThisNote} only from this note
									</span>
								</span>
								{confirming === note.id ? (
									<span className="flex shrink-0 gap-1">
										<Button type="button" size="xs" variant="destructive" className="cursor-pointer disabled:cursor-not-allowed"
											data-testid="library-missing-confirm" disabled={deleting} onClick={() => void deleteMissing([note.id])}>
											{note.onlyFromThisNote ? `Delete ${plural(note.onlyFromThisNote, "idea")}` : "Delete note"}
										</Button>
										<Button type="button" size="xs" variant="ghost" className="cursor-pointer text-muted-foreground hover:text-foreground"
											disabled={deleting} onClick={() => setConfirming(null)}>Cancel</Button>
									</span>
								) : (
									<Button type="button" size="xs" variant="ghost" className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
										data-testid="library-missing-delete" disabled={deleting} onClick={() => setConfirming(note.id)}>Delete</Button>
								)}
							</li>
						))}
					</ul>
				</SettingsGroup>
			)}
		</>
	);
}

/** One pattern per line, committed on blur (each commit saves the section
 * and rescans). Keyed by the saved list, so a save elsewhere resets it. */
function SkipList({ exclude, skipped, onCommit }: { exclude: string[]; skipped: number; onCommit: (next: string[]) => void }) {
	const saved = exclude.join("\n");
	const [draft, setDraft] = useState(saved);
	return (
		<div data-testid="library-row-skip" className="flex flex-col gap-1.5 py-1">
			<span>
				<span className="block font-prose text-(length:--lh-prose-size)">Skip</span>
				<span className="block text-xs text-muted-foreground/70">One per line: folder/, exact/path.md, or a glob (* inside a folder, ** across folders)</span>
			</span>
			<textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} aria-label="Vault paths to skip"
				data-testid="library-skip" spellCheck={false}
				onBlur={() => {
					const next = draft.split("\n").map((line) => line.trim()).filter(Boolean);
					if (next.join("\n") !== saved) onCommit(next);
				}}
				className="h-24 w-full resize-y rounded-sm border border-border bg-background p-2 font-mono text-xs text-foreground outline-none" />
			<p className="text-xs text-muted-foreground" data-testid="library-skip-count">{plural(skipped, "note")} skipped</p>
		</div>
	);
}
