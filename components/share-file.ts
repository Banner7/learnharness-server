/**
 * Export through the share sheet (phone wave): an `<a download>` in an
 * installed iOS web app opens a viewer with no way back, so a file goes to
 * navigator.share when the browser can share files (iOS/Android: Save to
 * Files, AirDrop, …) and falls back to a blob download elsewhere. The
 * share must run inside the click's user activation — callers fetch first
 * only when the browser keeps the activation (it does for one await of a
 * same-origin fetch on iOS 16+); if the share is refused for activation
 * reasons, the download still happens.
 */

/** Share `file` or download it. Resolves once handed off; a user cancel
 *  in the share sheet is not an error. */
export async function shareOrDownload(file: File): Promise<void> {
	if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
		try {
			await navigator.share({ files: [file], title: file.name });
			return;
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError") return;
			// NotAllowedError (activation lapsed) and friends: download instead.
		}
	}
	const url = URL.createObjectURL(file);
	const a = document.createElement("a");
	a.href = url;
	a.download = file.name;
	document.body.appendChild(a);
	a.click();
	a.remove();
	// Late revoke: some browsers start the download asynchronously.
	window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
