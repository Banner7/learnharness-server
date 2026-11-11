/**
 * THE FIRST-PAINT THEME (theme wave, 2026-11-04): what app/layout.tsx puts
 * on <html> before any client code runs — the record's appearance, the
 * active theme (a preset or an imported file; Automatic when the id is
 * gone) and its color variables with every override applied. Read the
 * record and only the selected custom file (the layout calls connection()
 * first, so this never bakes into a prerender).
 *
 * Automatic cannot know the system preference on the server, so it ships
 * BOTH variable sets (`auto`): the layout writes them as a
 * prefers-color-scheme stylesheet and a pre-paint script flips the class.
 */

import { effectiveColors, isBuiltinThemeId, resolveTheme, themeVars, type AppearanceSettings, type Theme, type ThemeMode } from "../core";
import { themeStore } from "../store/themes.ts";
import { readSettings } from "../store/settings.ts";

/** Everything the layout needs for a flash-free first paint. */
export interface ThemeBoot {
	appearance: AppearanceSettings | undefined;
	/** The active theme (Automatic resolves as its light rendering). */
	theme: Theme;
	/** The CSS variables for <html style> (empty for Automatic). */
	vars: Record<string, string>;
	/** Automatic only: the variables per system mode. */
	auto: Record<ThemeMode, Record<string, string>> | null;
	/** The browser bar color per mode (both equal unless Automatic). */
	themeColor: Record<ThemeMode, string>;
}

function varsFor(theme: Theme, appearance: AppearanceSettings | undefined) {
	return themeVars(effectiveColors(theme, appearance), theme.mode, theme.extras);
}

/** Read the record and selected custom file; resolve the active theme and its vars. */
export function readThemeBoot(): ThemeBoot {
	const appearance = readSettings()?.appearance;
	const id = appearance?.theme;
	const custom = id && !isBuiltinThemeId(id) ? themeStore.readTheme(id) : null;
	const customs = custom ? [custom] : [];
	const theme = resolveTheme(id, customs);
	if (theme.follows) {
		const light = resolveTheme(id, customs, "light");
		const dark = resolveTheme(id, customs, "dark");
		return {
			appearance,
			theme,
			vars: {},
			auto: { light: varsFor(light, appearance), dark: varsFor(dark, appearance) },
			themeColor: {
				light: effectiveColors(light, appearance).background,
				dark: effectiveColors(dark, appearance).background,
			},
		};
	}
	const vars = varsFor(theme, appearance);
	const bg = effectiveColors(theme, appearance).background;
	return { appearance, theme, vars, auto: null, themeColor: { light: bg, dark: bg } };
}
