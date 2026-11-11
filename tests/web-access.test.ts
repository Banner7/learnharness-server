import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { browserAccessFailure } from "../src/server/web-access.ts";
import { proxy } from "../proxy.ts";
const secret = "a".repeat(64);
const origin = "http://127.0.0.1:12345";

test("every path is gated and browser access fails closed", () => {
	const names = ["LH_WEB_ACCESS_TOKEN", "LH_WEB_ORIGIN"] as const;
	const saved = names.map((name) => process.env[name]);
	const request = (path: string, headers: Record<string, string> = {}) => proxy(new NextRequest(origin + path, { headers }));
	try {
		delete process.env.LH_WEB_ACCESS_TOKEN;
		delete process.env.LH_WEB_ORIGIN;
		assert.equal(request("/chat/new").status, 503);
		process.env.LH_WEB_ACCESS_TOKEN = secret;
		process.env.LH_WEB_ORIGIN = origin;
		for (const path of ["/", "/chat/new", "/_next/static/chunks/app.js", "/fonts/cmunbx.woff", "/manifest.webmanifest", "/api/events", "/api/settings", "/api/chats/scratch/markdown"]) {
			const unauthenticated = request(path, { host: "127.0.0.1:12345" });
			assert.equal(unauthenticated.status, 401, path);
			assert.match(unauthenticated.headers.get("www-authenticate") ?? "", /^Basic /);
			assert.equal(unauthenticated.headers.get("cache-control"), "private, no-store");
		}
		for (const path of ["/chat/new", "/_next/static/chunks/app.js", "/api/nope"]) {
			const authorized = request(path, {
				host: "127.0.0.1:12345",
				authorization: `Basic ${Buffer.from(`learnharness:${secret}`).toString("base64")}`,
			});
			assert.notEqual(authorized.status, 401, path);
			assert.notEqual(authorized.status, 403, path);
			assert.equal(authorized.headers.get("cache-control"), "private, no-store", path);
		}
	} finally {
		names.forEach((name, index) => {
			if (saved[index] === undefined) delete process.env[name];
			else process.env[name] = saved[index];
		});
	}
});

test("browser access validates dedicated credentials, public origin and mutation CSRF boundary", () => {
	const env = { LH_WEB_ACCESS_TOKEN: secret, LH_WEB_ORIGIN: "https://learn.tailnet.invalid:8443" };
	const headers = new Headers({
		host: "learn.tailnet.invalid:8443",
		authorization: `Basic ${Buffer.from(`learnharness:${secret}`).toString("base64")}`,
	});
	assert.equal(browserAccessFailure(headers, "GET", env), null);
	assert.equal(browserAccessFailure(headers, "POST", env)?.status, 403, "mutations require Origin");
	headers.set("origin", env.LH_WEB_ORIGIN);
	for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
		assert.equal(browserAccessFailure(headers, method, env), null, method);
	}
	for (const mutation of [
		{ host: "127.0.0.1:3000" },
		{ origin: "https://attacker.invalid" },
		{ origin: "null" },
		{ "sec-fetch-site": "cross-site" },
		{ "sec-fetch-site": "same-site" },
	]) {
		const altered = new Headers(headers);
		Object.entries(mutation).forEach(([name, value]) => altered.set(name, value));
		assert.equal(browserAccessFailure(altered, "GET", env)?.status, 403, JSON.stringify(mutation));
	}
	// Cross-site top-level page loads pass (Firefox on iOS); everything else
	// cross-site stays refused.
	const navigation = new Headers(headers);
	navigation.delete("origin");
	navigation.set("sec-fetch-site", "cross-site");
	navigation.set("sec-fetch-mode", "navigate");
	navigation.set("sec-fetch-dest", "document");
	for (const path of ["/", "/chat/new"]) {
		assert.equal(browserAccessFailure(navigation, "GET", env, path), null, path);
	}
	for (const [method, path] of [["GET", "/api/settings"], ["GET", "/api"], ["POST", "/"], ["GET", undefined]] as const) {
		assert.equal(browserAccessFailure(navigation, method, env, path)?.status, 403, `${method} ${path}`);
	}
	for (const [name, value] of [["sec-fetch-mode", "cors"], ["sec-fetch-dest", "iframe"], ["origin", "https://attacker.invalid"]] as const) {
		const altered = new Headers(navigation);
		altered.set(name, value);
		assert.equal(browserAccessFailure(altered, "GET", env, "/")?.status, 403, `${name}=${value}`);
	}
	const unauthenticatedNavigation = new Headers(navigation);
	unauthenticatedNavigation.delete("authorization");
	assert.equal(browserAccessFailure(unauthenticatedNavigation, "GET", env, "/")?.status, 401);
	headers.delete("authorization");
	assert.equal(browserAccessFailure(headers, "GET", env)?.status, 401);
	headers.set("authorization", `Basic ${Buffer.from(`wrong-user:${secret}`).toString("base64")}`);
	assert.equal(browserAccessFailure(headers, "GET", env)?.status, 401);
	assert.equal(browserAccessFailure(headers, "GET", {})?.status, 503);
	for (const invalidOrigin of ["http://learn.tailnet.invalid", "https://user:pass@learn.tailnet.invalid", env.LH_WEB_ORIGIN + "/path", "not-a-url"]) {
		assert.equal(browserAccessFailure(headers, "GET", { ...env, LH_WEB_ORIGIN: invalidOrigin })?.status, 503);
	}
});

