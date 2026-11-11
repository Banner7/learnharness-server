import type { MetadataRoute } from "next";

/** The home-screen app (phone wave): standalone, so an installed copy opens
 *  without browser chrome. Colors are the Kanagawa Kasumi pair — the splash
 *  is the dark ink, the bar the light sand; the live bar color follows the
 *  active theme through the theme-color meta (app/layout.tsx). */
export default function manifest(): MetadataRoute.Manifest {
	return {
		name: "Learning Harness",
		short_name: "LearnHarness",
		description: "A teacher agent with a memory — sessions, quizzes, and a knowledge graph of what you know.",
		start_url: "/",
		scope: "/",
		display: "standalone",
		background_color: "#1a2026",
		theme_color: "#d9d1ba",
		icons: [
			{ src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
			{ src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
			{ src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
		],
	};
}
