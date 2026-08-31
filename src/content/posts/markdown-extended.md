---
title: Markdown 扩展功能
published: 2024-05-01
updated: 2024-11-29
description: '进一步了解 Fuwari 支持的 Markdown 功能'
image: ''
tags: [演示, 示例, Markdown, Fuwari]
category: '示例'
draft: false
---

## GitHub 仓库卡片
你可以插入指向 GitHub 仓库的动态卡片。页面加载时，卡片会通过 GitHub API 获取仓库信息。

::github{repo="Fabrizz/MMM-OnSpotify"}

使用 `::github{repo="<owner>/<repo>"}` 即可创建一张 GitHub 仓库卡片。

```markdown
::github{repo="saicaca/fuwari"}
```

## 提示框

支持以下几种提示框类型：`note` `tip` `important` `warning` `caution`

:::note
用于强调读者即使只是快速浏览，也应该留意的信息。
:::

:::tip
可选的补充信息，帮助读者更顺利地完成操作。
:::

:::important
读者必须了解的关键信息，否则无法顺利完成操作。
:::

:::warning
存在潜在风险、需要读者立即注意的重要内容。
:::

:::caution
某项操作可能带来的负面后果。
:::

### 基本语法

```markdown
:::note
用于强调读者即使只是快速浏览，也应该留意的信息。
:::

:::tip
可选的补充信息，帮助读者更顺利地完成操作。
:::
```

### 自定义标题

提示框的标题可以自行指定。

:::note[我的自定义标题]
这是一个带有自定义标题的提示框。
:::

```markdown
:::note[我的自定义标题]
这是一个带有自定义标题的提示框。
:::
```

### GitHub 语法

> [!TIP]
> 同样支持 [GitHub 的提示框语法](https://github.com/orgs/community/discussions/16925)。

```
> [!NOTE]
> 同样支持 GitHub 的提示框语法。

> [!TIP]
> 同样支持 GitHub 的提示框语法。
```

### 剧透遮罩

你可以给文本加上剧透遮罩，遮罩内的文本同样支持 **Markdown** 语法。

内容 :spoiler[被藏起来了 **哎呀**]！

```markdown
内容 :spoiler[被藏起来了 **哎呀**]！

```
