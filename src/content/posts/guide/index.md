---
title: Fuwari 简明使用指南
published: 2024-04-01
description: "如何使用这个博客模板。"
image: "./cover.jpeg"
tags: ["Fuwari", "博客写作", "自定义"]
category: 指南
draft: false
---

> 封面图片来源：[原图](https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/208fc754-890d-4adb-9753-2c963332675d/width=2048/01651-1456859105-(colour_1.5),girl,_Blue,yellow,green,cyan,purple,red,pink,_best,8k,UHD,masterpiece,male%20focus,%201boy,gloves,%20ponytail,%20long%20hair,.jpeg)

本博客模板基于 [Astro](https://astro.build/) 构建。本指南未提到的内容，可以在 [Astro 官方文档](https://docs.astro.build/) 中找到答案。

## 文章的 Frontmatter

```yaml
---
title: 我的第一篇博客文章
published: 2023-09-09
description: 这是我的新 Astro 博客的第一篇文章。
image: ./cover.jpg
tags: [Foo, Bar]
category: 前端
draft: false
---
```

| 字段            | 说明                                                                                                                                        |
|---------------|-------------------------------------------------------------------------------------------------------------------------------------------|
| `title`       | 文章的标题。                                                                                                                                    |
| `published`   | 文章的发布日期。                                                                                                                                  |
| `description` | 文章的简短描述，会显示在首页的文章列表中。                                                                                                                     |
| `image`       | 文章封面图的路径。<br/>1. 以 `http://` 或 `https://` 开头：使用网络图片<br/>2. 以 `/` 开头：使用 `public` 目录下的图片<br/>3. 不带上述任何前缀：相对于当前 Markdown 文件的路径 |
| `tags`        | 文章的标签。                                                                                                                                    |
| `category`    | 文章的分类。                                                                                                                                    |
| `draft`       | 该文章是否仍是草稿；草稿不会被展示出来。                                                                                                                      |

## 文章文件应该放在哪里



文章文件应放在 `src/content/posts/` 目录下。你也可以新建子目录，以便更好地组织文章和相关资源。

```
src/content/posts/
├── post-1.md
└── post-2/
    ├── cover.png
    └── index.md
```
