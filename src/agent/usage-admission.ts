/** Usage that was never admitted to a provider (a queued worker request that
 * never ran) must not reach the money channel. Transient identity only: no
 * provenance field enters saved native messages. */
const USAGE_KEY = Symbol.for("lh.unadmittedUsage");
const usageGlobal = globalThis as typeof globalThis & { [USAGE_KEY]?: WeakSet<object> };
const unadmittedUsage = usageGlobal[USAGE_KEY] ??= new WeakSet<object>();

export function markUnadmittedUsage(usage: object): void { unadmittedUsage.add(usage); }
export function usageWasAdmitted(usage: object): boolean { return !unadmittedUsage.has(usage); }
