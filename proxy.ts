import { NextResponse, type NextRequest } from "next/server";
import { SECURITY_HEADERS, webAccessRefusal } from "./src/server/web-access.ts";

/** The browser access gate for EVERY path: pages, assets, /_next and the
 * API, including SSE and spending/settings routes. The one streamed
 * document route enforces the identical gate inside its handler, avoiding
 * Next's silently truncated Proxy body clone. No public callback or worker
 * bypass. Cache-Control here is a fallback: routes, pages and hashed
 * assets that set their own keep it. */
export function proxy(request: NextRequest) {
	const refusal = webAccessRefusal(request, request.nextUrl.pathname);
	if (refusal) return refusal;
	const response = NextResponse.next();
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
	response.headers.set("Cache-Control", "private, no-store");
	return response;
}

export const config = {
	// Every path except the exact streamed endpoint (not the documents
	// subtree or other plugin routes). Must remain a static literal.
	matcher: ["/((?!api/plugins/[^/]+/documents/markdown/?$).*)"],
};
