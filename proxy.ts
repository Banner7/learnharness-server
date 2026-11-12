import { NextResponse, type NextRequest } from "next/server";
import { SECURITY_HEADERS, webAccessRefusal } from "./src/server/web-access.ts";

/** The browser access gate for EVERY path: pages, assets, /_next and the
 * API, including SSE and spending/settings routes. The one streamed
 * document route enforces the identical gate inside its handler, avoiding
 * Next's silently truncated Proxy body clone. No public callback or worker
 * bypass. Cache-Control here is a fallback: routes and pages that set their
 * own keep it. Content-hashed /_next/static/ files get none, so Next sends
 * its own `immutable`; the bundled fonts never change between builds and get
 * a long private lifetime. Neither holds user data; the gate above still runs
 * for every request that reaches the server. */
export function proxy(request: NextRequest) {
	const refusal = webAccessRefusal(request, request.nextUrl.pathname);
	if (refusal) return refusal;
	const response = NextResponse.next();
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
	const pathname = request.nextUrl.pathname;
	if (pathname.startsWith("/fonts/")) response.headers.set("Cache-Control", "private, max-age=31536000, immutable");
	else if (!pathname.startsWith("/_next/static/")) response.headers.set("Cache-Control", "private, no-store");
	return response;
}

export const config = {
	// Every path except the exact streamed endpoint (not the documents
	// subtree or other plugin routes). Must remain a static literal.
	matcher: ["/((?!api/plugins/[^/]+/documents/markdown/?$).*)"],
};
