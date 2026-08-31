import path from "node:path";
import { url } from "@utils/url-utils";
import type { ImageMetadata } from "astro";

export type OgImage = {
	/** Absolute URL, or a site-root-relative path to be resolved against `Astro.site`. */
	src: string;
	width?: number;
	height?: number;
};

// TODO temporary workaround for images dynamic import, same as ImageWrapper.astro
// https://github.com/withastro/astro/issues/3373
const localImages = import.meta.glob<ImageMetadata>(
	"../**/*.{png,jpg,jpeg,webp,avif,gif}",
	{ import: "default" },
);

/**
 * 把封面/横幅路径解析成社交预览图，接受与 `image` frontmatter 相同的三种写法：
 * `http(s)://` 外链、以 `/` 开头的 /public 路径、以及相对于 `basePath` 的 /src 内路径。
 * 解析不到时返回 undefined，让调用方回退到站点默认图而不是让构建失败。
 */
export async function resolveOgImage(
	src: string | undefined,
	basePath = "/",
): Promise<OgImage | undefined> {
	if (!src || src.trim() === "") {
		return undefined;
	}
	if (/^(https?:)?\/\//.test(src) || src.startsWith("data:")) {
		return { src };
	}
	if (src.startsWith("/")) {
		return { src: url(src) };
	}

	const assetPath = path
		.normalize(path.join("../", basePath, src))
		.replace(/\\/g, "/");
	const loadImage = localImages[assetPath];
	if (!loadImage) {
		console.error(
			`\n[ERROR] Social preview image not found: ${assetPath.replace("../", "src/")}`,
		);
		return undefined;
	}

	const image = await loadImage();
	return { src: image.src, width: image.width, height: image.height };
}
