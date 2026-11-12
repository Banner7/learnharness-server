/** Test helper: write the operator config file (LH_CONFIG_FILE). Each write
 *  gets a distinct mtime so the store's stat cache sees the edit. Set
 *  LH_CONFIG_FILE before the first import of config.ts. */
import fs from "node:fs";

let tick = 0;

export function writeServerConfig(config: Record<string, unknown>): void {
	const file = process.env.LH_CONFIG_FILE;
	if (!file) throw new Error("LH_CONFIG_FILE is not set for this test process");
	fs.writeFileSync(file, JSON.stringify(config));
	const t = new Date(Date.UTC(2026, 0, 1) + ++tick * 1000);
	fs.utimesSync(file, t, t);
}

export function setClaudeCodeEnabled(enabled: boolean): void {
	writeServerConfig({ claudeCode: { enabled } });
}
