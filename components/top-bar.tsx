"use client";

/**
 * THE TOP BAR (owner standardization ruling, 2026-09-29): one element,
 * every surface — the same mechanics ALWAYS. Born from the chains-overlay
 * incident: its hand-rolled bar broke every rule at once (wrong height,
 * wrong title size, no sidebar reopen). The law: whenever a surface has a
 * top bar, it renders THIS component — never a bespoke header.
 *
 * Mechanics baked in (the chat-session bar's proven pattern):
 * - h-15 (60px) — matches the sidebar's wordmark band, one border line.
 * - select-none — clicking around the bar never highlights the title.
 * - SidebarToggle FIRST — the sidebar reopen when closed. Host knowledge
 *   pickers omit the action.
 * - border-b border-border px-3, gap-3 rhythm.
 * - Phone wave: the notch's safe area pads the top (the bar grows by it,
 *   so the 60px row stays whole) and the sides; on touch, its buttons
 *   are at least 44px tall.
 *
 * The consumer brings the title (font-title text-2xl sm:text-3xl tracking-tight) and
 * any right-side controls. THE TITLE LAW (owner round 11, 2026-10-05):
 * the serif title names a session or a registered plugin view (plugin UI
 * ruling, 2026-11-01); chrome-less creation surfaces (home, both /chat/new
 * drafts) and the chain table render NO title.
 */

import type { ReactNode } from "react";
import { SidebarToggle } from "@/components/sidebar";

export function TopBar({
	onMouseDown,
	children,
	sidebarToggle = true,
}: {
	onMouseDown?: React.MouseEventHandler<HTMLElement>;
	children?: ReactNode;
	/** Host picker chrome omits the sidebar reopen action. */
	sidebarToggle?: boolean;
}) {
	return (
		<header
			onMouseDown={onMouseDown}
			className="flex h-[calc(3.75rem+env(safe-area-inset-top))] shrink-0 select-none items-center gap-3 border-b border-border pt-[env(safe-area-inset-top)] pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] pointer-coarse:[&_button]:min-h-11"
		>
			{sidebarToggle && <SidebarToggle />}
			{children}
		</header>
	);
}
