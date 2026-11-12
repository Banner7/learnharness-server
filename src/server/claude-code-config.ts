import { getClaudeBinary } from "../agent/claude-code/binary.ts";
import { configStore } from "../store/config.ts";

/** The operator config file's opt-in (`claudeCode.enabled`), re-read when the
 * file changes. Fresh admission state, not a process-wide cache: existing runs
 * retain their engines; only new chat/job/extraction/compaction admissions
 * consult it. */
export function claudeCodeEnabled(): boolean {
	return configStore.read().config.claudeCode.enabled;
}

/** Installation/opt-in availability only, never authenticated readiness. */
export function claudeCodeAvailable(): boolean {
	return claudeCodeEnabled() && getClaudeBinary() !== null;
}
