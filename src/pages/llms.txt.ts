import type { APIRoute } from "astro";
import { siteConfig } from "@/config";
import { getSortedPosts } from "@utils/content-utils";
import { url } from "@utils/url-utils";

// llms.txt 约定(https://llmstxt.org/):给 LLM / AI 抓取器的站点入口,
// 每篇文章直接链接到对应的 .md 版本
export const GET: APIRoute = async ({ site }) => {
	const base = site ?? new URL("https://blog.cobweb11.top");
	const posts = await getSortedPosts();

	const lines: string[] = [
		`# ${siteConfig.title}`,
		"",
		`> ${siteConfig.subtitle || siteConfig.title}`,
		"",
		"## Blog Posts",
		"",
	];

	for (const post of posts) {
		const mdUrl = new URL(url(`/posts/${post.slug}.md`), base).href;
		const description = post.data.description || post.data.title;
		lines.push(`- [${post.data.title}](${mdUrl}): ${description}`);
	}

	return new Response(`${lines.join("\n")}\n`, {
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
		},
	});
};
