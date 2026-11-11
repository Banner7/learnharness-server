import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next, JetBrains_Mono, Source_Sans_3 } from "next/font/google";
import { connection } from "next/server";
import "katex/dist/katex.min.css";
import "./globals.css";
import { AppShell, SidebarProvider } from "@/components/sidebar";
import { ActivityProvider } from "@/components/activity-dock";
import { ServerEventsProvider } from "@/components/server-events";
import { AppearanceProvider } from "@/components/settings/appearance";
import { PluginsProvider } from "@/components/plugins";
import { readThemeBoot } from "@/src/server";

// Kasumi type: controls = Atkinson Hyperlegible Next, teaching prose and
// titles = Computer Modern Serif (the bundled lh-cmu @font-face in
// globals.css — no CDN), code = JetBrains Mono. Source Sans 3 stays a
// bundled reading-font choice (Settings → Appearance).
const ui = Atkinson_Hyperlegible_Next({ subsets: ["latin"], variable: "--font-atkinson" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });
const sans = Source_Sans_3({ subsets: ["latin"], variable: "--font-sans3", preload: false });

export const metadata: Metadata = {
	title: "Learning Harness",
	description: "A teacher agent with a memory — sessions, quizzes, and a knowledge graph of what you know.",
	// Home-screen app (phone wave): standalone on iOS, the notch under a
	// translucent status bar (the top bar pads itself by the safe area).
	appleWebApp: { capable: true, title: "LearnHarness", statusBarStyle: "black-translucent" },
	icons: {
		icon: [
			{ url: "/icon-192.png", sizes: "192x192", type: "image/png" },
			{ url: "/icon-512.png", sizes: "512x512", type: "image/png" },
		],
		apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
	},
};

/** The phone is the main screen: notch-aware (viewport-fit=cover) and
 *  zoom-locked, so fixed docks never drift under a pinch. The bar color
 *  follows the active theme (both modes for Automatic); the appearance
 *  provider keeps it current after live switches. */
export async function generateViewport(): Promise<Viewport> {
	await connection();
	const { themeColor } = readThemeBoot();
	return {
		width: "device-width",
		initialScale: 1,
		maximumScale: 1,
		userScalable: false,
		viewportFit: "cover",
		themeColor: [
			{ media: "(prefers-color-scheme: light)", color: themeColor.light },
			{ media: "(prefers-color-scheme: dark)", color: themeColor.dark },
		],
	};
}

/** Declarations for Automatic's first paint (html:root outranks the
 *  stylesheet's :root literals). */
function declarations(vars: Record<string, string>): string {
	return Object.entries(vars).map(([name, value]) => `${name}:${value}`).join(";");
}

/** Before first paint: Automatic follows the system — flip the class the
 *  server rendered as light. */
const AUTO_MODE_SCRIPT = `(function(){try{if(matchMedia("(prefers-color-scheme: dark)").matches){var c=document.documentElement.classList;c.remove("light");c.add("dark");}}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
	// The theme is server-rendered — its class AND its color variables —
	// so no first frame ever shows the wrong theme. connection(): the
	// record and the theme files are per-machine disk state — without it a
	// prerendered route (settings) would bake the BUILD machine's record.
	await connection();
	const { appearance, theme, vars, auto } = readThemeBoot();
	return (
		<html
			lang="en"
			className={`${theme.mode} ${ui.variable} ${mono.variable} ${sans.variable}`}
			style={vars as React.CSSProperties}
			suppressHydrationWarning
		>
			<head>
				{auto ? (
					<>
						<style
							dangerouslySetInnerHTML={{
								__html: `html:root{${declarations(auto.light)}}@media (prefers-color-scheme: dark){html:root{${declarations(auto.dark)}}}`,
							}}
						/>
						<script dangerouslySetInnerHTML={{ __html: AUTO_MODE_SCRIPT }} />
					</>
				) : null}
			</head>
			<body className="min-h-dvh antialiased">
			{/* The notification channel rides OUTSIDE everything: sidebar, dock,
				 and pages all subscribe as the polls retire (push S3, 2026-10-02). */}
			<ServerEventsProvider>
				<PluginsProvider>
					<AppearanceProvider initialAppearance={appearance} initialTheme={theme}>
						<SidebarProvider>
							<ActivityProvider>
								<AppShell>{children}</AppShell>
							</ActivityProvider>
						</SidebarProvider>
					</AppearanceProvider>
				</PluginsProvider>
			</ServerEventsProvider>
		</body>
		</html>
	);
}
