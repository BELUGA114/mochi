import type { CollectionEntry } from "astro:content";
import { getSortedPosts } from "@utils/content-utils";
import { formatDateToYYYYMMDD } from "@utils/date-utils";
import { url } from "@utils/url-utils";
import type { APIRoute } from "astro";
import { siteConfig } from "@/config";

type Props = {
	entry: CollectionEntry<"posts">;
};

// 为 AI 抓取器 / Markdown 阅读器提供每篇文章的 .md 版本,与 HTML 路由共存:
// /posts/<slug>/ 渲染 HTML,本文件生成 /posts/<slug>.md
export const getStaticPaths = async (): Promise<
	{ params: { slug: string }; props: Props }[]
> => {
	const posts = await getSortedPosts();
	return posts.map((entry) => ({
		params: { slug: entry.slug },
		props: { entry },
	}));
};

// 字符串统一用 JSON.stringify 包裹:双引号转义后的结果同时也是合法 YAML
function yamlString(value: string): string {
	return JSON.stringify(value);
}

export const GET: APIRoute = ({ props, site }) => {
	const { entry } = props;
	const d = entry.data;

	const frontmatterLines = [
		`title: ${yamlString(d.title)}`,
		`published: ${formatDateToYYYYMMDD(d.published)}`,
	];
	if (d.updated) {
		frontmatterLines.push(`updated: ${formatDateToYYYYMMDD(d.updated)}`);
	}
	if (d.description) {
		frontmatterLines.push(`description: ${yamlString(d.description)}`);
	}
	if (d.tags.length > 0) {
		frontmatterLines.push(`tags: [${d.tags.map(yamlString).join(", ")}]`);
	}
	if (d.category) {
		frontmatterLines.push(`category: ${yamlString(d.category)}`);
	}
	frontmatterLines.push(
		`lang: ${yamlString((d.lang || siteConfig.lang).replace("_", "-"))}`,
	);
	frontmatterLines.push(
		`canonical: ${yamlString(
			new URL(url(`/posts/${entry.slug}/`), site ?? "https://blog.cobweb11.top")
				.href,
		)}`,
	);

	const markdown = `---\n${frontmatterLines.join("\n")}\n---\n\n${entry.body ?? ""}\n`;

	return new Response(markdown, {
		headers: {
			"Content-Type": "text/markdown; charset=utf-8",
			// 与 Worker 的协商响应一致，利于缓存按 Accept 分桶
			Vary: "Accept",
			// 明确允许 AI/搜索抓取器索引与跟随
			"X-Robots-Tag": "all",
		},
	});
};
