import type { Favicon } from "@/types/config.ts";

/*
 * One icon per job, in the order browsers need it:
 *   - the ICO first, because Safari picks the *first* `rel=icon` and cannot be
 *     relied on for SVG favicons;
 *   - the SVG last, because Firefox picks the *last* one and ignores the `media`
 *     attribute — the light/dark switch lives inside the SVG instead.
 * Declaring several `media`-qualified rasters here makes Firefox fetch icons
 * from both schemes and flip between them on every reload.
 */
export const defaultFavicons: Favicon[] = [
	{
		src: "/favicon/favicon.ico",
		sizes: "32x32",
	},
	{
		src: "/favicon/favicon.svg",
		type: "image/svg+xml",
	},
	{
		src: "/favicon/apple-touch-icon.png",
		rel: "apple-touch-icon",
		sizes: "180x180",
	},
];
