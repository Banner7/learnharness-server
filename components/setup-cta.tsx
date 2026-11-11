"use client";
/**
 * The zero-keys surfaces: when NO model-provider key is configured on the
 * server, chat / home / /chat/new hoist a composer pill that takes
 * PRECEDENCE over the models setup CTA (the model pickers list only what
 * keys unlock). Click opens the SetupDialog. Truth: the model catalog's
 * provider rows (keyPresent).
 */

import { useEffect, useState } from "react";
import { MODEL_SLOTS, type ModelCatalogResponse } from "@/src/core";
import { useModelCatalog } from "@/components/model-catalog";

/** Completeness is saved identity, not current provider availability. */
export function savedSlotsConfigured(slots: ModelCatalogResponse["slots"] | undefined): boolean {
	return MODEL_SLOTS.every((slot) => !!slots?.[slot]?.model);
}

/** Keep the last known completeness during connection invalidation, but
 * follow ordinary slot repairs as soon as their shared snapshot arrives. */
export function useModelSetup(initialConfigured: boolean) {
	const { catalog } = useModelCatalog();
	const [lastConfigured, setLastConfigured] = useState(initialConfigured);
	const configured = catalog ? savedSlotsConfigured(catalog.slots) : lastConfigured;
	useEffect(() => { if (catalog) setLastConfigured(savedSlotsConfigured(catalog.slots)); }, [catalog]);
	return { catalog, configured, zeroKeys: catalog ? !catalog.providers.some((p) => p.keyPresent) : false };
}

/** A known unavailable route needs an explicit replacement, never an
 * automatic provider/model substitution. Unknown metadata defers to the
 * server's admission gate instead of declaring a route disconnected. */
export function selectedModelUnavailable(catalog: ModelCatalogResponse | undefined, selected: string | undefined): boolean {
	return !!catalog && !!selected && !catalog.models.some((m) => `${m.provider}:${m.id}` === selected);
}

/** Reuse the ordinary control (also opened by the existing keyboard action). */
export function openModelPicker(): void {
	window.dispatchEvent(new CustomEvent("lh:kbd-open-model-picker"));
}

/** The zero-keys truth for the calling page: TRUE only after a
 *  successful read says no provider key exists (pending and failed
 *  reads render nothing — the pill must never flash on a gap, and a
 *  failed read claiming "zero keys" would be a lie the CTA flow then
 *  leans on). */
export function useZeroKeys(): boolean {
	const { catalog } = useModelCatalog();
	return catalog ? !catalog.providers.some((provider) => provider.keyPresent) : false;
}

/** The pill itself — the models CTA's chrome and placement, the keys
 *  chain's copy. testid "setup-cta-keys" (the models CTA keeps
 *  "setup-cta"; probes can tell them apart). */
export function ZeroKeysPill({ onOpen, inline = false }: { onOpen: () => void; inline?: boolean }) {
	const button = (
		<button
			type="button"
			data-testid="setup-cta-keys"
			onClick={onOpen}
			className="rounded-sm border border-border bg-card px-3 py-1.5 font-ui text-xs text-foreground transition-colors hover:border-muted-foreground/50 hover:bg-accent cursor-pointer"
		>
			Set up providers
		</button>
	);
	return inline ? button : <div className="pointer-events-auto mb-2 flex justify-center">{button}</div>;
}
/** Pure: the strong slot is pinned to a provider whose key is GONE (owner
 *  interlude, 2026-09-25 — the original deleted-key scenario). The catalog
 *  already knows both halves: slots.strong is the resolved pin, providers[]
 *  lists only PRESENT-key providers (keyless ones are absent, the same
 *  discipline as the search engines). False when the strong slot is unset
 *  (the models guard owns that case — this check only runs when slots ARE
 *  configured) or the catalog hasn't loaded (the server gate remains the
 *  belt). Exported for pins. */
export function strongKeyless(catalog: ModelCatalogResponse | undefined): boolean {
	const strong = catalog?.slots.strong;
	if (!strong) return false;
	return !catalog.providers.some((p) => p.id === strong.model.provider && p.keyPresent);
}

/** The strong-slot keyless truth for the PRE-SEND guard (home / /chat/new):
 *  the catalog seam, re-read when the strong slot is re-pinned ("models").
 *  Live-updates with the page, never mid-send. */
export function useStrongKeyless(): boolean {
	const { catalog } = useModelCatalog();
	return strongKeyless(catalog);
}
