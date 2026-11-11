/** Configures the browser gate for http://localhost and returns the headers an
 *  authorized same-origin browser request carries. */
export const GATE_TOKEN = "a".repeat(64);
export const GATE_ORIGIN = "http://localhost";

export function configureGate(): void {
	process.env.LH_WEB_ORIGIN = GATE_ORIGIN;
	process.env.LH_WEB_ACCESS_TOKEN = GATE_TOKEN;
	delete process.env.LH_TAILSCALE_USERS;
}

export function gateHeaders(extra: HeadersInit = {}): Headers {
	const headers = new Headers(extra);
	headers.set("host", "localhost");
	headers.set("origin", GATE_ORIGIN);
	headers.set("sec-fetch-site", "same-origin");
	headers.set("authorization", `Basic ${Buffer.from(`learnharness:${GATE_TOKEN}`).toString("base64")}`);
	return headers;
}
