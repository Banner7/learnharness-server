"use client";

import { PaperclipIcon } from "lucide-react";
import { Hint } from "@/components/ui/hint";
import { BROWSER_NOTICE } from "@/components/file-path-drop-zone";

/**
 * The attach button (issue #285). A browser File carries no server path, so the
 * button only explains how to attach a path (the drop zone's notice).
 * aria-disabled, not disabled, so the tooltip still shows.
 */
export function AttachFilesButton() {
	return (
		<div className="relative shrink-0">
			<Hint label={BROWSER_NOTICE}>
				<button
					type="button"
					aria-label="Attach files"
					aria-disabled
					data-testid="attach-files"
					className="flex size-10 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground"
				>
					<PaperclipIcon className="size-4" />
				</button>
			</Hint>
		</div>
	);
}
