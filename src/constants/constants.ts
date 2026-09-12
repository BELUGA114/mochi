export const PAGE_SIZE = 8;

export const LIGHT_MODE = "light",
	DARK_MODE = "dark",
	AUTO_MODE = "auto";
export const DEFAULT_THEME = AUTO_MODE;

// Banner height unit: vh
export const BANNER_HEIGHT = 35;
export const BANNER_HEIGHT_EXTEND = 30;
export const BANNER_HEIGHT_HOME = BANNER_HEIGHT + BANNER_HEIGHT_EXTEND;

// The height the main panel overlaps the banner, unit: rem
export const MAIN_PANEL_OVERLAPS_BANNER_HEIGHT = 3.5;

// Page width: rem
export const PAGE_WIDTH = 75;

// Default wallpaper parameters, shared between Layout.astro and Wallpaper.astro
export const WALLPAPER_OVERLAY_DEFAULT = { light: 0.2, dark: 0.4 } as const;
export const WALLPAPER_CARD_OPACITY_DEFAULT = {
	light: 0.78,
	dark: 0.8,
} as const;
