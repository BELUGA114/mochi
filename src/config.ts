import type {
	ExpressiveCodeConfig,
	LicenseConfig,
	NavBarConfig,
	ProfileConfig,
	SiteConfig,
} from "./types/config";
import { LinkPreset } from "./types/config";

export const siteConfig: SiteConfig = {
	title: "mochi",
	subtitle: "Neko Site",
	lang: "zh_CN", // Language code, e.g. 'en', 'zh_CN', 'ja', etc.
	themeColor: {
		hue: 270, // Default hue for the theme color, from 0 to 360. e.g. red: 0, teal: 200, cyan: 250, pink: 345
		fixed: false, // Hide the theme color picker for visitors
	},
	banner: {
		enable: false,
		src: "assets/images/demo-banner.png", // Relative to the /src directory. Relative to the /public directory if it starts with '/'
		position: "center", // Equivalent to object-position, only supports 'top', 'center', 'bottom'. 'center' by default
		credit: {
			enable: false, // Display the credit text of the banner image
			text: "", // Credit text to be displayed
			url: "", // (Optional) URL link to the original artwork or artist's page
		},
	},
	wallpaper: {
		enable: true, // Site-wide fixed wallpaper background. Takes precedence over the banner above when enabled
		images: [
			"assets/images/wallpapers/1.jpg", // Relative to the /src directory
			// "/wallpapers/2.jpg", // Relative to the /public directory if it starts with '/'
			// "https://example.com/3.png", // An http(s):// URL is used as is
		],
		// overlay: { light: 0.2, dark: 0.4 }, // Dimming overlay opacity, defaults shown
		cardOpacity: { light: 0.75, dark: 0.77 }, // Card background opacity, defaults shown
	},
	toc: {
		enable: true, // Display the table of contents on the right side of the post
		depth: 2, // Maximum heading depth to show in the table, from 1 to 3
	},
	favicon: [
		// Leave this array empty to use the default favicon
		// {
		//   src: '/favicon/icon.png',    // Path of the favicon, relative to the /public directory
		//   theme: 'light',              // (Optional) Either 'light' or 'dark', set only if you have different favicons for light and dark mode
		//   sizes: '32x32',              // (Optional) Size of the favicon, set only if you have favicons of different sizes
		// }
	],
	ogImage: "/og.jpg", // Fallback social preview image, 1200x630 recommended. Relative to /public when it starts with '/'
};

export const navBarConfig: NavBarConfig = {
	links: [
		LinkPreset.Home,
		LinkPreset.Archive,
		LinkPreset.About,
		//		{
		//			name: "GitHub",
		//			url: "https://github.com/saicaca/fuwari", // Internal links should not include the base path, as it is automatically added
		//			external: true, // Show an external link icon and will open in a new tab
		//		},
	],
};

export const profileConfig: ProfileConfig = {
	avatar: "assets/images/mochi.png", // Relative to the /src directory. Relative to the /public directory if it starts with '/'
	name: "Mochi团子",
	bio: "你是一袋猫粮",
	links: [
		{
			name: "Twitter",
			icon: "fa6-brands:twitter", // Visit https://icones.js.org/ for icon codes
			// You will need to install the corresponding icon set if it's not already included
			// `pnpm add @iconify-json/<icon-set-name>`
			url: "https://twitter.com",
		},
		{
			name: "Steam",
			icon: "fa6-brands:steam",
			url: "https://store.steampowered.com",
		},
		{
			name: "GitHub",
			icon: "fa6-brands:github",
			url: "https://github.com/BELUGA114/mochi",
		},
	],
};

export const licenseConfig: LicenseConfig = {
	enable: true,
	name: "CC0 1.0 Universal",
	url: "https://creativecommons.org/publicdomain/zero/1.0/",
};

export const expressiveCodeConfig: ExpressiveCodeConfig = {
	// Note: Some styles (such as background color) are being overridden, see the astro.config.mjs file.
	// Please select a dark theme, as this blog theme currently only supports dark background color
	theme: "github-dark",
};
