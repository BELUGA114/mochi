# 博客维护指南

本文档面向本仓库（Fuwari 模板 + Cloudflare Workers 部署）的日常维护，说明改哪个文件能改到什么、
文章能玩出哪些花样、以及每次更新的完整流程。

> 结论先行：**几乎所有个性化都集中在 `src/config.ts` 一个文件里**；文章内容在 `src/content/posts/`；
> 想要“首页不显示但归档里显示”这类行为，模板没有开箱支持，但只需要两处共 5 行改动（第 4 节给出已验证的补丁）。

## 速查表

| 我想改… | 改这里 |
|:--|:--|
| 站名、副标题、语言、主题色、Banner、TOC、favicon | `src/config.ts` → `siteConfig` |
| 头像、昵称、简介、社交外链 | `src/config.ts` → `profileConfig` |
| 顶部导航栏的条目 | `src/config.ts` → `navBarConfig` |
| 文章底部的版权协议块 | `src/config.ts` → `licenseConfig` |
| 代码块配色 | `src/config.ts` → `expressiveCodeConfig` |
| “关于”页正文 | `src/content/spec/about.md` |
| 页脚那行 “Powered by Astro & Fuwari” | `src/components/Footer.astro`（硬编码） |
| 首页每页文章数 | `src/constants/constants.ts` → `PAGE_SIZE` |
| 网站域名 | `astro.config.mjs` → `site`，以及 `src/pages/rss.xml.ts` 里的兜底值 |
| 界面文案（“主页/归档/未分类/分钟”等） | `src/i18n/languages/zh_CN.ts` |
| favicon 图片本体 | `public/favicon/` |
| 头像、Banner 等图片本体 | `src/assets/images/` |
| 新增文章 | `pnpm new-post <名字>`，生成到 `src/content/posts/` |

## 目录

1. [个性化配置](#1-个性化配置srcconfigts)
2. [头像、简介与外链](#2-头像简介与外链)
3. [写文章](#3-写文章)
4. [文章的可控性：能玩什么、要改什么](#4-文章的可控性能玩什么要改什么)
5. [本地开发与验证](#5-本地开发与验证)
6. [发布上线](#6-发布上线)
7. [已知坑](#7-已知坑)

---

## 1. 个性化配置（`src/config.ts`）

这个文件是整站的唯一配置源，类型定义在 `src/types/config.ts`，构建时被布局、组件甚至
`astro.config.mjs` 直接 import。改完它需要重启 `pnpm dev` 才能完全生效（部分值是构建期常量）。

### siteConfig

| 字段 | 作用与注意点 |
|:--|:--|
| `title` | 导航栏站名、浏览器标题后缀、RSS 标题。页面标题格式是 `{页面标题} - {title}`，首页是 `{title} - {subtitle}` |
| `subtitle` | 只用在首页标题和 RSS 描述里 |
| `lang` | **只能取 `src/types/config.ts` 里列出的 10 个值**（`en` `zh_CN` `zh_TW` `ja` `ko` `es` `th` `vi` `tr` `id`）。它在构建期一次性决定全站文案，不是按请求切换。同时写进 `<html lang>`（`_` 会换成 `-`） |
| `themeColor.hue` | 主题色色相 0–360。这是默认值，访客自己调过之后存在浏览器 `localStorage.hue` 里，会覆盖它 |
| `themeColor.fixed` | 设为 `true` 会隐藏导航栏的调色盘按钮，访客不能再改色相 |
| `toc.enable` / `toc.depth` | 文章右侧目录开关与最大标题层级（1–3）。注意目录只在 **≥1536px（`2xl`）** 的宽屏显示，窄屏本来就看不到 |
| `favicon` | 留空数组时使用 `src/constants/icon.ts` 里的默认三件套（`/favicon/favicon.ico`、`favicon.svg`、`apple-touch-icon.png`），图片本体在 `public/favicon/` |

Banner（首页顶部大图）单独说一下，它目前有个坑：

```ts
banner: {
    enable: false,                              // 改成 true 才会显示
    src: "assets/images/demo-banner.png",       // 相对 /src；以 / 开头则相对 /public
    position: "center",                          // top / center / bottom
    credit: { enable: false, text: "", url: "" }, // 图片来源署名
}
```

`src/layouts/Layout.astro` 里有一行 `banner = siteConfig.banner.src`（带 `TODO` 注释），
它会无条件覆盖传进来的 banner，所以**“用文章封面当页面顶部大图”这个能力目前是被关掉的**，
文章封面只会显示在文章正文上方和列表卡片里。

另外注意 favicon 数组的顺序有讲究（`src/constants/icon.ts` 的注释里写了原因）：Safari 取第一个
`rel=icon`、Firefox 取最后一个并忽略 `media`，所以现在的顺序是 ico 在前、svg 在后，
明暗切换做在 SVG 内部。如果自己重排或加多个带 `media` 的 PNG，Firefox 会每次刷新都闪一下图标。

### licenseConfig / expressiveCodeConfig

`licenseConfig` 控制每篇文章正文下方的版权块（作者名取 `profileConfig.name`）。
`enable: false` 可以整块关掉。

`expressiveCodeConfig.theme` 是代码块主题，**必须选深色主题**——`astro.config.mjs` 里只覆盖了
深色背景变量，选亮色主题会出现前景背景撞色。

---

## 2. 头像、简介与外链

### profileConfig

```ts
export const profileConfig: ProfileConfig = {
    avatar: "assets/images/mochi.png",  // 相对 /src；以 / 开头则相对 /public
    name: "Mochi团子",
    bio: "你是一袋猫粮",
    links: [
        { name: "GitHub", icon: "fa6-brands:github", url: "https://github.com/..." },
    ],
};
```

- **头像**：图片放 `src/assets/images/`，`avatar` 写相对 `src/` 的路径（不要写 `src/` 前缀）。
  也可以填 `/xxx.png` 走 `public/`，或直接填 `http(s)://` 外链。
  走 `src/` 的本地图会经过 Astro 的图片优化；**路径写错时构建会先打印
  `[ERROR] Image file not found: ...` 然后直接失败**，所以改完一定要跑一次构建。
  头像在侧边栏是方形圆角卡片，建议用正方形图。
- **`name`** 出现在三处：侧边栏昵称、页脚 `© 年份 name. All Rights Reserved.`、文章末尾版权块的“作者”。
- **`bio`** 只出现在侧边栏头像下方，纯文本，不解析 Markdown。留空就不显示。
- **`links`** 是社交外链，全部 `target="_blank"`：
  - `icon` 用 [Iconify](https://icones.js.org/) 的图标代码，格式 `图标集:图标名`。
  - 当前已安装的图标集只有 `fa6-brands`、`fa6-regular`、`fa6-solid`、`material-symbols`。
    用别的集合要先 `pnpm add @iconify-json/<集合名>`。（`astro.config.mjs` 里 `icon.include`
    那份清单只是限定打包范围，`material-symbols` 没列进去也能正常用；那份清单里还有一条
    `"preprocess: vitePreprocess(),"` 是上游误粘贴进去的无害脏数据。）
  - **渲染方式随数量变化**：填 2 个及以上时只显示图标方块；只填 1 个时会显示“图标 + 名字”的长按钮；
    填 0 个则整行消失。想统一成图标样式，至少填 2 个。

### 导航栏 navBarConfig

```ts
links: [
    LinkPreset.Home,        // 预设项，名字来自 i18n
    LinkPreset.Archive,
    LinkPreset.About,
    { name: "GitHub", url: "https://github.com/...", external: true },
],
```

- 三个预设项（`Home` / `Archive` / `About`）的显示文字来自 `src/i18n/languages/zh_CN.ts`，
  想改成“首页/时间轴/关于我”就改那个文件（预设项的路径定义在 `src/constants/link-presets.ts`）。
- 自定义项：`external: true` 会加一个外链图标并在新标签页打开；**内部链接不要带 base 前缀**，
  代码里会自动补（`url()`）。
- 顺序就是显示顺序；窄屏会收进右上角的汉堡菜单。

### 关于页与页脚

- “关于”页正文是 `src/content/spec/about.md`，**目前还是上游的英文演示内容**，需要自己重写。
  它走的是完整 Markdown 管线，所以提示框、GitHub 卡片、公式这些扩展语法都能用。
- 页脚的 `Powered by Astro & Fuwari` 和 RSS / Sitemap 链接写死在
  `src/components/Footer.astro`，要改得动组件本身。
- 社交预览图（`og:image`）**目前完全没有**，分享到微信/Twitter 不会带图。想要的话需要在
  `src/layouts/Layout.astro` 的 `<head>` 里自己加 `og:image`。

---

## 3. 写文章

### 新建

```bash
pnpm new-post 我的第一篇文章          # → src/content/posts/我的第一篇文章.md
pnpm new-post 我的文章/index          # → src/content/posts/我的文章/index.md（连目录一起建）
```

两种组织方式都支持：

```
src/content/posts/
├── post-1.md              # 单文件，URL 是 /posts/post-1/
└── post-2/                # 目录形式，URL 是 /posts/post-2/
    ├── cover.png          # 配图放旁边，frontmatter 里写 ./cover.png
    └── index.md
```

文章有配图时**强烈建议用目录形式**，图片和正文放一起，搬动文章不会断图。
URL slug 就是文件名（或目录名），改文件名等于换 URL，老链接会 404。

脚本生成的 frontmatter 里 `title` 直接用了你传的参数，用子目录形式时会变成
`title: 我的文章/index`，记得手动改回来。

### frontmatter 字段

校验规则在 `src/content/config.ts`（Zod schema），填错字段名或类型构建会直接报错。

| 字段 | 必填 | 说明 |
|:--|:--|:--|
| `title` | 是 | 文章标题 |
| `published` | 是 | 发布日期，`2024-05-01` 或完整 ISO 时间。**全站排序、归档分年都按它** |
| `updated` | 否 | 更新日期。只有与 `published` 不同才会显示，且只显示在文章页（列表卡片上隐藏） |
| `description` | 否 | 列表卡片和 `og:description` 用。**留空时会自动截取正文开头当摘要** |
| `image` | 否 | 封面图，显示在列表卡片右侧和文章正文上方 |
| `tags` | 否 | 字符串数组 |
| `category` | 否 | 单个字符串，留空/`null` 归入“未分类” |
| `draft` | 否 | `true` = 草稿，见下 |
| `lang` | 否 | 单篇文章的语言，只影响这篇文章 `<html lang>` 和结构化数据；留空跟随全站 |

`prevTitle` / `prevSlug` / `nextTitle` / `nextSlug` 虽然在 schema 里，但标着
“for internal use”——**不要手写**，它们由 `getSortedPosts()` 排序后自动填充，用来生成文章底部的
上一篇/下一篇按钮。

`image` 的路径有三种写法，规则和 `avatar` 一致：

1. `http://` 或 `https://` 开头 → 网络图片
2. `/` 开头 → `public/` 目录下的文件
3. 都不带前缀 → **相对于该 Markdown 文件**，例如 `./cover.jpeg`

### 自动生成的东西

字数、阅读时间、摘要都由 `src/plugins/` 下的 remark 插件在构建时算出来，不用管也不能在
frontmatter 里覆盖。`description` 留空时，列表卡片会退回用自动摘要。

### 可用的扩展语法

仓库里两篇示例文章就是活文档，改版式前先去看它们的效果：

- `src/content/posts/markdown-extended.md` —— 提示框（`:::note` / `tip` / `important` /
  `warning` / `caution`，支持自定义标题和 GitHub 的 `> [!NOTE]` 写法）、GitHub 仓库卡片
  （`::github{repo="owner/repo"}`）、剧透遮罩（`:spoiler[...]`）
- `src/content/posts/expressive-code.md` —— 代码块的全部玩法：文件名/终端窗框、行号、
  折叠区块、行标记与文本标记、diff 语法、自动换行
- `src/content/posts/markdown.md` —— 基础语法 + KaTeX 数学公式（行内 `$...$`，行间 `$$...$$`）

标题会自动生成锚点（中文标题的锚点就是标题本身，`#二级标题` 这样直接可用）。

### 分类与标签

- 分类和标签**没有独立页面**，点击后跳到归档页并用查询参数过滤：
  `/archive/?category=示例`、`/archive/?tag=Markdown`、未分类是 `/archive/?uncategorized=true`。
- 因此**改分类名/标签名等于换掉那个筛选链接**，站内没有重定向。
- 侧边栏的分类和标签列表由 `getCategoryList()` / `getTagList()` 自动统计，不需要在任何地方登记。
- 一篇文章只能有一个分类，标签可以多个。

### 可选：图形化编辑

仓库带了 `frontmatter.json`，装 VS Code 扩展 [Front Matter CMS](https://frontmatter.codes/)
就能有个后台界面管理这些字段。不用也完全没问题，它只是个配置文件。

---

## 4. 文章的可控性：能玩什么、要改什么

### 开箱就有的

| 需求 | 做法 |
|:--|:--|
| 完全不发布（连页面都不生成） | `draft: true`。`pnpm dev` 下仍然可见方便预览，生产构建里会消失——从首页、归档、RSS、侧边栏统计、搜索索引里全部消失 |
| 调整文章顺序 | 改 `published`，全站统一按它倒序 |
| 首页每页显示几篇 | `src/constants/constants.ts` 的 `PAGE_SIZE`（现在是 8） |
| 关掉某篇文章的目录 | 没有单篇开关，`siteConfig.toc.enable` 是全站的 |
| 关掉版权块 | 同样只有全站开关 `licenseConfig.enable` |

草稿的过滤条件是 `import.meta.env.PROD ? data.draft !== true : true`，在
`src/utils/content-utils.ts` 里**重复出现了三次**（文章列表、标签统计、分类统计）。
如果要改草稿语义，三处都得改，漏一处会出现“首页没有但标签计数里有”的鬼影。

### 需要改代码的：首页隐藏、置顶

“首页不显示、归档里仍然显示”**模板没有内置**，但改动很小。原理是首页和归档取数据的入口不同：

- 首页 `src/pages/[...page].astro` → `getSortedPosts()`
- 归档 `src/pages/archive.astro` → `getSortedPostsList()`

所以只在首页那一侧过滤即可，归档自动不受影响。下面这个补丁同时加了「首页隐藏」和「置顶」两个开关
（已在本仓库实测通过）：

**第一步**：`src/content/config.ts`，在 `lang` 那行后面加两个字段

```ts
		lang: z.string().optional().default(""),

		/* 自定义扩展：控制文章在首页列表中的显示 */
		hideOnHome: z.boolean().optional().default(false),
		pinned: z.boolean().optional().default(false),
```

（仓库用 Tab 缩进，粘贴时注意别混进空格，否则 Biome 会报格式问题。）

**第二步**：`src/pages/[...page].astro`，改 `getStaticPaths`

```ts
export const getStaticPaths = (async ({ paginate }) => {
	const allBlogPosts = await getSortedPosts();
	const homePosts = allBlogPosts
		.filter((post) => !post.data.hideOnHome)
		.sort((a, b) => Number(b.data.pinned) - Number(a.data.pinned));
	return paginate(homePosts, { pageSize: PAGE_SIZE });
}) satisfies GetStaticPaths;
```

之后在任意文章的 frontmatter 里写 `hideOnHome: true` 或 `pinned: true` 即可。

要点：

- `Array.prototype.sort` 在现代 V8 里是**稳定排序**，所以置顶只会把标记过的文章提到最前面，
  其余文章仍保持原本的日期倒序。
- 过滤发生在 `getSortedPosts()` **之后**，而上一篇/下一篇是在 `getSortedPosts()` 里按全量文章串起来的，
  所以被隐藏的文章仍然在“上一篇/下一篇”链条里。想让它从链条里消失就得改 `content-utils.ts`。
- **`hideOnHome` 只影响首页列表**，下面这些地方仍然包含这篇文章（多数情况下这正是想要的效果）：

  | 位置 | 是否仍包含 | 想排除的话改哪里 |
  |:--|:--|:--|
  | 归档页 | 是（目标行为） | `src/pages/archive.astro` |
  | 文章自己的页面 `/posts/<slug>/` | 是 | `src/pages/posts/[...slug].astro` |
  | 侧边栏分类/标签计数 | 是 | `src/utils/content-utils.ts` 的两个统计函数 |
  | RSS | 是 | `src/pages/rss.xml.ts` |
  | Sitemap | 是 | 需要给 `@astrojs/sitemap` 配 `filter` |
  | Pagefind 搜索 | 是 | 给容器加 `data-pagefind-ignore`，或用 `pagefind.yml` 排除 |

如果目标是“对外完全不可见”，别绕这套，直接 `draft: true` 更干净。

---

## 5. 本地开发与验证

只能用 pnpm（`preinstall` 里有 `only-allow pnpm`），Node ≥ 20，`.nvmrc` 锁 22。

| 命令 | 用途 |
|:--|:--|
| `pnpm install` | 装依赖 |
| `pnpm dev` | 开发服务器 `localhost:4321`，热更新，**草稿可见** |
| `pnpm build` | `astro build` + `pagefind --site dist`（后者生成搜索索引） |
| `pnpm preview` | 起本地服务器跑 `dist/`，**唯一能真正测试搜索的方式** |
| `pnpm check` | `astro check`，检查 `.astro`/`.svelte`/`.ts` 的类型 |
| `pnpm lint` | Biome 检查并自动修复 |
| `pnpm format` | Biome 只格式化 |

**搜索必须构建后才能测**：Pagefind 是在 `astro build` 之后扫描 `dist/` 生成索引的，
`pnpm dev` 下 `Search.svelte` 会返回一组硬编码的假结果。所以改完东西想验证搜索，
必须 `pnpm build && pnpm preview`。

发布前的验证清单（本仓库没有测试框架，这三步就是全部）：

```bash
pnpm check      # 0 errors
pnpm lint       # 或 biome lint ./src
pnpm build      # 必须成功，且末尾能看到 pagefind 的 "Indexed N pages"
```

只改了 Markdown 正文的话，跑 `pnpm build` 一步就够——构建会校验 frontmatter、图片路径和自定义语法。

> 如果 `pnpm` 不在 PATH 里，用绝对路径调用：`& "D:\Node.js\node_global\pnpm.cmd" build`。
> 仓库通过 `packageManager` 字段锁了 pnpm 9.14.4，全局版本会自动切换，不需要额外装。

---

## 6. 发布上线

**推送到 `main` 就会自动部署**，没有别的步骤：

```bash
git add src/content/posts/我的新文章.md
git commit -m "post: 我的新文章"    # 仓库用 Conventional Commits
git push
```

- Cloudflare Workers Builds 监听 `main`，构建命令是 **`pnpm build`**，部署命令 `npx wrangler deploy`。
  这里有个致命细节：Astro 官方 Cloudflare 指南给的是 `npx astro build`，**那条命令会跳过
  `pagefind --site dist`**，结果 `dist/pagefind/` 不生成，线上每个页面都正常但搜索静默失效。
  不要照抄官方文档改这个构建命令。
- GitHub Actions 里的两个 workflow（`build.yml` 做 `astro check` + `astro build`，
  `biome.yml` 做格式检查）**只做检查、不负责部署**。
- 想在推送前确认 Cloudflare 配置没问题：`./node_modules/.bin/wrangler deploy --dry-run`，
  它只校验 `wrangler.jsonc` 并报告资源数量，不登录、不上传。
- 站点没有 `404.astro`，走的是 Workers 默认 404 页。想自定义需要新建 `src/pages/404.astro`
  并在 `wrangler.jsonc` 里设 `assets.not_found_handling: "404-page"`。

改域名要同时改两处：`astro.config.mjs` 的 `site` 和 `src/pages/rss.xml.ts` 里的兜底
`"https://blog.cobweb11.top"`，另外 `wrangler.jsonc` 的 `routes` 里也有一条自定义域记录。

---

## 7. 已知坑

### 构建偶发失败：`The 'link' class does not exist`

症状：`pnpm build` 报

```
[vite:css] [postcss] src/styles/markdown.css:23:9:
The `link` class does not exist. If `link` is a custom class, make sure it is defined within a `@layer` directive.
```

**重跑一次通常就好**（观测到 5 次构建里失败 2 次，都发生在只改了 Markdown 内容之后）。

原因分析：`.link` 定义在 `src/styles/main.css` 的 `@layer components` 里，而
`src/styles/markdown.css` 里用了 `@apply ... link ...`。这些 CSS 文件谁都没被显式 import，
它们是被 `src/components/misc/ImageWrapper.astro` 里那句 `import.meta.glob("../../**")`
连带扫进构建图的，各自作为独立的 PostCSS 入口编译。`@apply link` 能不能解析，取决于
`main.css` 是否恰好先被处理过——于是构建顺序一变就有概率失败。Tailwind 的 content glob
包含 `src/**/*.md`，所以改文章正好会扰动这个顺序。

如果 Cloudflare 上遇到，在 Dashboard 点 Retry deployment 即可。想彻底消灭它，需要把
`.link` / `expand-animation` 从 `@layer components` 挪进 `tailwind.config.cjs` 的
`addComponents` 插件里（这样它们属于 Tailwind 配置上下文，任何入口都能 `@apply`），
或者把 `markdown.css` 里的 `@apply link` 展开成底层工具类。**目前没有改**，属于上游遗留问题。

### 本地 `biome ci` 报所有文件都没格式化

Windows 检出时 `core.autocrlf=true`，工作区是 CRLF，而 Biome 的 `lineEnding` 默认 `lf`，
于是本地 `biome ci ./src` 会把**每个文件**都标成未格式化。这纯粹是本地假象，CI 跑在 Linux 上看到的是 LF。
本地要一个可信的 lint 信号，用不带格式化的 `biome lint ./src`。

### 其他

- `src/config.ts` 里 `title: "Fuwari"` / `subtitle: "Demo Site"` **还是上游的演示值**，
  站点已经上线但站名没改，建议尽早改掉。
- `docs/README.*.md` 是上游的多语言 README，与本仓库配置无关。
- 客户端 JS 有个特殊约束：站点用 `@swup/astro` 做无刷新页面切换，只替换 `main` 和 `#toc` 容器。
  任何新加的浏览器端初始化逻辑都必须注册到 `window.swup.hooks` 上（照抄 `Layout.astro` 里的写法），
  否则第一次站内跳转之后就会静默失效。这条只在改组件/脚本时才需要关心，写文章不受影响。
- i18n 文案文件必须实现 `Translation` 类型的**全部**枚举键，少一个 `pnpm check` 就报错。
  新增语言要在 `src/i18n/languages/` 加文件，并在 `src/i18n/translation.ts` 的 `map` 里登记。
- `src/i18n/i18nKey.ts` 里有 `comments` 这个键，但**没有任何评论系统**接进来，别被误导。







