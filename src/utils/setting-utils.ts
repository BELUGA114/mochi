import {
	AUTO_MODE,
	DARK_MODE,
	DEFAULT_MOTION,
	DEFAULT_THEME,
	LIGHT_MODE,
	MOTION_AUTO,
	MOTION_REDUCE,
} from "@constants/constants.ts";
import { expressiveCodeConfig } from "@/config";
import type { LIGHT_DARK_MODE, MOTION_MODE } from "@/types/config";

export function getDefaultHue(): number {
	const fallback = "250";
	const configCarrier = document.getElementById("config-carrier");
	return Number.parseInt(configCarrier?.dataset.hue || fallback, 10);
}

export function getHue(): number {
	const stored = localStorage.getItem("hue");
	return stored ? Number.parseInt(stored, 10) : getDefaultHue();
}

export function setHue(hue: number): void {
	localStorage.setItem("hue", String(hue));
	const r = document.querySelector(":root") as HTMLElement;
	if (!r) {
		return;
	}
	r.style.setProperty("--hue", String(hue));
}

export function applyThemeToDocument(theme: LIGHT_DARK_MODE) {
	switch (theme) {
		case LIGHT_MODE:
			document.documentElement.classList.remove("dark");
			break;
		case DARK_MODE:
			document.documentElement.classList.add("dark");
			break;
		case AUTO_MODE:
			if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
				document.documentElement.classList.add("dark");
			} else {
				document.documentElement.classList.remove("dark");
			}
			break;
	}

	// Set the theme for Expressive Code
	document.documentElement.setAttribute(
		"data-theme",
		expressiveCodeConfig.theme,
	);
}

export function setTheme(theme: LIGHT_DARK_MODE): void {
	localStorage.setItem("theme", theme);
	applyThemeToDocument(theme);
}

export function getStoredTheme(): LIGHT_DARK_MODE {
	return (localStorage.getItem("theme") as LIGHT_DARK_MODE) || DEFAULT_THEME;
}

export function getStoredMotion(): MOTION_MODE {
	return (localStorage.getItem("motion") as MOTION_MODE) || DEFAULT_MOTION;
}

export function applyMotionToDocument(mode: MOTION_MODE): void {
	// auto 档才看系统偏好;reduce/full 显式覆盖。结果只落成 <html>.reduce-motion 单一 class
	const reduce =
		mode === MOTION_REDUCE ||
		(mode === MOTION_AUTO &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches);
	document.documentElement.classList.toggle("reduce-motion", reduce);
}

export function setMotion(mode: MOTION_MODE): void {
	localStorage.setItem("motion", mode);
	applyMotionToDocument(mode);
}
