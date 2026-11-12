import { timingSafeEqual } from "node:crypto";

type Env = Record<string, string | undefined>;
type AccessFailure = { status: 401 | 403 | 503; error: string };

/** Headers every response carries, refusals included. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
	"X-Frame-Options": "DENY",
	"Referrer-Policy": "same-origin",
	"X-Content-Type-Options": "nosniff",
});

const CROSS_ORIGIN_ERROR = "Cross-origin browser access is not allowed.";

/** A single-owner browser gate: an allowlisted Tailscale Serve identity, or
 *  the HTTP Basic access token. Never trusts forwarded auth. `pathname` is
 *  optional; without it every request gets the strict cross-site check. */
export function browserAccessFailure(
	headers: Headers,
	method: string,
	env: Env = process.env,
	pathname?: string,
): AccessFailure | null {
	const token = env.LH_WEB_ACCESS_TOKEN;
	const configuredOrigin = env.LH_WEB_ORIGIN;
	if (!token || !/^[a-f0-9]{64}$/i.test(token) || !configuredOrigin) {
		return { status: 503, error: "Browser access requires LH_WEB_ACCESS_TOKEN and LH_WEB_ORIGIN on the server." };
	}

	let origin: URL;
	try {
		origin = new URL(configuredOrigin);
	} catch {
		return { status: 503, error: "LH_WEB_ORIGIN must be an HTTPS origin (or HTTP loopback for local development)." };
	}
	const localHTTP = origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
	if ((!localHTTP && origin.protocol !== "https:") || origin.username || origin.password ||
		origin.pathname !== "/" || origin.search || origin.hash) {
		return { status: 503, error: "LH_WEB_ORIGIN must be an HTTPS origin (or HTTP loopback for local development)." };
	}

	// The reverse proxy must preserve the public Host. Do not accept spoofable
	// forwarding headers or alternate origins, even with the right password.
	// This exact-host pin is also the DNS-rebinding defense.
	if (headers.get("host")?.toLowerCase() !== origin.host.toLowerCase()) {
		return { status: 403, error: "Browser access requires the configured LH_WEB_ORIGIN host." };
	}
	const suppliedOrigin = headers.get("origin");
	const fetchSite = headers.get("sec-fetch-site");
	const safeMethod = method === "GET" || method === "HEAD" || method === "OPTIONS";
	// Top-level page loads may arrive cross-site: some mobile browsers serve
	// their start and restore pages from localhost, so a page load from them
	// is labeled `cross-site`. A page load still needs the login below,
	// cannot be framed (X-Frame-Options) and gives the other site nothing to
	// read. APIs, the event stream and every mutation keep the strict
	// same-origin rule.
	const pageLoad = (method === "GET" || method === "HEAD") &&
		headers.get("sec-fetch-mode") === "navigate" && headers.get("sec-fetch-dest") === "document" &&
		pathname !== undefined && pathname !== "/api" && !pathname.startsWith("/api/");
	if ((suppliedOrigin !== null && suppliedOrigin !== origin.origin) ||
		(!pageLoad && fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none") ||
		(!safeMethod && suppliedOrigin !== origin.origin)) {
		return { status: 403, error: CROSS_ORIGIN_ERROR };
	}

	// Tailscale Serve deletes client-supplied Tailscale-User-* headers and sets
	// them only for untagged tailnet users, but nothing here can tell whether a
	// request came through Serve: ANY client that reaches this listener can
	// send the header. The invariant LH_TAILSCALE_USERS relies on is that only
	// the Serve proxy can reach the listener (e.g. it shares the container's
	// network namespace). The stock image listens on 0.0.0.0, so host
	// processes and containers on a shared Docker network can forge it; leave
	// LH_TAILSCALE_USERS unset unless the deployment guarantees that.
	const allowedLogins = (env.LH_TAILSCALE_USERS ?? "").split(",")
		.map((login) => login.trim().toLowerCase()).filter(Boolean);
	const login = headers.get("tailscale-user-login")?.trim().toLowerCase();
	if (login && allowedLogins.includes(login)) return null;

	// Basic auth lets Safari supply credentials to native fetch, downloads and
	// EventSource without placing this capability in a URL, JS or localStorage.
	const supplied = headers.get("authorization");
	const match = supplied && supplied.length < 256 ? /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(supplied) : null;
	const actual = Buffer.from(match?.[1] ?? "");
	const expected = Buffer.from(Buffer.from(`learnharness:${token}`).toString("base64"));
	if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
		return { status: 401, error: "Sign in with username learnharness and the server's browser access token." };
	}
	return null;
}

/** The gate as a response: undefined admits the request. Shared by Proxy and
 *  the one streamed route that bypasses Proxy's truncated body clone. */
export function webAccessRefusal(request: Request, pathname = new URL(request.url).pathname, env: Env = process.env): Response | undefined {
	const failure = browserAccessFailure(request.headers, request.method, env, pathname);
	if (!failure) return undefined;
	// Host mismatches (the compose health probe, port scanners) stay quiet;
	// a cross-origin refusal is the one worth a log line.
	if (failure.error === CROSS_ORIGIN_ERROR) {
		const q = (name: string) => JSON.stringify(request.headers.get(name));
		console.warn(`[access] 403 ${request.method} ${JSON.stringify(pathname)} site=${q("sec-fetch-site")} mode=${q("sec-fetch-mode")} dest=${q("sec-fetch-dest")} origin=${q("origin")} ua=${q("user-agent")}`);
	}
	const headers: Record<string, string> = { ...SECURITY_HEADERS, "Cache-Control": "private, no-store" };
	if (failure.status === 401) headers["WWW-Authenticate"] = 'Basic realm="LearnHarness", charset="UTF-8"';
	return Response.json({ error: failure.error }, { status: failure.status, headers });
}
