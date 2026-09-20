// 瘦 Worker：唯一职责是对文章页做 Accept 头内容协商。
// 命中 text/markdown 时，改道到 build 已产出的 /posts/<slug>.md 静态资产；
// 其余请求一律透传给静态资产，保持纯静态站行为不变。
// 不做任何 HTML→markdown 转换。

interface Env {
	// 静态资产 binding：调用不会再触发本 Worker，因此改道到 .md 不会自循环。
	ASSETS: { fetch(request: Request): Promise<Response> };
}

// 仅匹配文章 HTML 页：/posts/<slug>/（trailingSlash: "always"）。
// 不匹配已带扩展名的 /posts/<slug>.md 本身。
const POST_PAGE = /^\/posts\/(.+)\/$/;

function wantsMarkdown(accept: string | null): boolean {
	return accept != null && accept.toLowerCase().includes("text/markdown");
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const match = POST_PAGE.exec(url.pathname);

		if (
			request.method === "GET" &&
			match &&
			wantsMarkdown(request.headers.get("Accept"))
		) {
			// /posts/<slug>/ -> /posts/<slug>.md
			const mdUrl = new URL(request.url);
			mdUrl.pathname = `/posts/${match[1]}.md`;
			const mdResponse = await env.ASSETS.fetch(
				new Request(mdUrl.toString(), { headers: request.headers }),
			);
			if (mdResponse.ok) {
				const headers = new Headers(mdResponse.headers);
				headers.set("Vary", "Accept");
				return new Response(mdResponse.body, {
					status: mdResponse.status,
					headers,
				});
			}
			// 理论不该发生（每篇文章都产出 .md）：回退到原 HTML。
		}

		return env.ASSETS.fetch(request);
	},
};
