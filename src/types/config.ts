import type { AUTO_MODE, DARK_MODE, LIGHT_MODE } from "@constants/constants";

export type SiteConfig = {
	title: string;
	subtitle: string;

	lang:
		| "en"
		| "zh_CN"
		| "zh_TW"
		| "ja"
		| "ko"
		| "es"
		| "th"
		| "vi"
		| "tr"
		| "id";

	themeColor: {
		hue: number;
		fixed: boolean;
	};
	banner: {
		enable: boolean;
		src: string;
		position?: "top" | "center" | "bottom";
		credit: {
			enable: boolean;
			text: string;
			url?: string;
		};
	};
	/**
	 * Site-wide fixed wallpaper background. Takes precedence over `banner`:
	 * when enabled, the top banner strip is not rendered.
	 */
	wallpaper?: WallpaperConfig;
	toc: {
		enable: boolean;
		depth: 1 | 2 | 3;
	};

	favicon: Favicon[];

	/**
	 * Default social preview image (`og:image`), used for every page that has no cover of its own.
	 * Same path rules as `banner.src`: relative to /src, or relative to /public if it starts with '/'.
	 * An `http(s)://` URL is used as is. Leave it out to emit no `og:image` at all.
	 */
	ogImage?: string;
};

export type WallpaperConfig = {
	enable: boolean;
	/**
	 * Wallpaper image candidates. One entry = fixed wallpaper; multiple entries =
	 * one is picked at random on each site visit / full page reload.
	 * Same path rules as `banner.src`: relative to /src, or relative to /public
	 * if it starts with '/'. An http(s):// URL is used as is.
	 */
	images: string[];
	/**
	 * Dimming overlay opacity over the wallpaper, for text readability.
	 * Defaults to `{ light: 0.2, dark: 0.4 }`.
	 */
	overlay?: { light: number; dark: number };
	/**
	 * Card background opacity, lets the wallpaper show through content cards.
	 * Defaults to `{ light: 0.78, dark: 0.72 }`.
	 */
	cardOpacity?: { light: number; dark: number };
};

export type Favicon = {
	src: string;
	theme?: "light" | "dark";
	sizes?: string;
	/** MIME type of the icon, e.g. 'image/svg+xml'. Lets browsers skip formats they cannot render. */
	type?: string;
	/** Link relation, defaults to 'icon'. Use 'apple-touch-icon' for the iOS home-screen icon. */
	rel?: string;
};

export enum LinkPreset {
	Home = 0,
	Archive = 1,
	About = 2,
}

export type NavBarLink = {
	name: string;
	url: string;
	external?: boolean;
};

export type NavBarConfig = {
	links: (NavBarLink | LinkPreset)[];
};

export type ProfileConfig = {
	avatar?: string;
	name: string;
	bio?: string;
	links: {
		name: string;
		url: string;
		icon: string;
	}[];
};

export type LicenseConfig = {
	enable: boolean;
	name: string;
	url: string;
};

export type LIGHT_DARK_MODE =
	| typeof LIGHT_MODE
	| typeof DARK_MODE
	| typeof AUTO_MODE;

export type BlogPostData = {
	body: string;
	title: string;
	published: Date;
	description: string;
	tags: string[];
	draft?: boolean;
	image?: string;
	category?: string;
	prevTitle?: string;
	prevSlug?: string;
	nextTitle?: string;
	nextSlug?: string;
};

export type ExpressiveCodeConfig = {
	theme: string;
};
