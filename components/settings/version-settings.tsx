"use client";

import { SettingsRow } from "./controls.tsx";

const APP_VERSION = process.env.LH_VERSION ?? "";
const HOMEPAGE = process.env.LH_HOMEPAGE ?? "";

/** The running server's version and a link to its release notes. */
export function VersionSettings({
	version = APP_VERSION,
	homepage = HOMEPAGE,
}: {
	version?: string;
	homepage?: string;
}) {
	const releaseNotes = version && homepage ? `${homepage}/releases/tag/v${version}` : null;
	return (
		<SettingsRow
			label={`Version ${version || "unknown"}`}
			testid="row-version"
			hint={releaseNotes && <a href={releaseNotes} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:text-foreground hover:underline" data-testid="release-notes">Release notes</a>}
		>
			{null}
		</SettingsRow>
	);
}
