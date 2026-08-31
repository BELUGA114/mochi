---
title: Expressive Code 示例
published: 2024-04-10
description: 使用 Expressive Code 后，Markdown 中的代码块是什么样子。
tags: [Markdown, 博客写作, 演示]
category: 示例
draft: false
---

下面来看看借助 [Expressive Code](https://expressive-code.com/) 渲染出来的代码块效果。这里的示例都来自官方文档，需要了解更多细节可以直接查阅官方文档。

## Expressive Code

### 语法高亮

[Syntax Highlighting](https://expressive-code.com/key-features/syntax-highlighting/)

#### 普通语法高亮

```js
console.log('这段代码带有语法高亮！')
```

#### 渲染 ANSI 转义序列

```ansi
ANSI colors:
- Regular: [31mRed[0m [32mGreen[0m [33mYellow[0m [34mBlue[0m [35mMagenta[0m [36mCyan[0m
- Bold:    [1;31mRed[0m [1;32mGreen[0m [1;33mYellow[0m [1;34mBlue[0m [1;35mMagenta[0m [1;36mCyan[0m
- Dimmed:  [2;31mRed[0m [2;32mGreen[0m [2;33mYellow[0m [2;34mBlue[0m [2;35mMagenta[0m [2;36mCyan[0m

256 colors (showing colors 160-177):
[38;5;160m160 [38;5;161m161 [38;5;162m162 [38;5;163m163 [38;5;164m164 [38;5;165m165[0m
[38;5;166m166 [38;5;167m167 [38;5;168m168 [38;5;169m169 [38;5;170m170 [38;5;171m171[0m
[38;5;172m172 [38;5;173m173 [38;5;174m174 [38;5;175m175 [38;5;176m176 [38;5;177m177[0m

Full RGB colors:
[38;2;34;139;34mForestGreen - RGB(34, 139, 34)[0m

Text formatting: [1mBold[0m [2mDimmed[0m [3mItalic[0m [4mUnderline[0m
```

### 编辑器与终端窗框

[Editor & Terminal Frames](https://expressive-code.com/key-features/frames/)

#### 编辑器窗框

```js title="my-test-file.js"
console.log('title 属性示例')
```

---

```html
<!-- src/content/index.html -->
<div>文件名注释示例</div>
```

#### 终端窗框

```bash
echo "这个终端窗框没有标题"
```

---

```powershell title="PowerShell 终端示例"
Write-Output "这个就有标题了！"
```

#### 覆盖窗框类型

```sh frame="none"
echo "快看，没有窗框！"
```

---

```ps frame="code" title="PowerShell Profile.ps1"
# 如果不覆盖类型，这里会被渲染成终端窗框
function Watch-Tail { Get-Content -Tail 20 -Wait $args }
New-Alias tail Watch-Tail
```

### 文本与行标记

[Text & Line Markers](https://expressive-code.com/key-features/text-markers/)

#### 标记整行与行区间

```js {1, 4, 7-8}
// 第 1 行 —— 由行号选中
// 第 2 行
// 第 3 行
// 第 4 行 —— 由行号选中
// 第 5 行
// 第 6 行
// 第 7 行 —— 由区间 "7-8" 选中
// 第 8 行 —— 由区间 "7-8" 选中
```

#### 选择行标记类型（mark、ins、del）

```js title="line-markers.js" del={2} ins={3-4} {6}
function demo() {
  console.log('这一行被标记为已删除')
  // 这一行和下一行被标记为新增
  console.log('这是第二行新增内容')

  return '这一行使用中性的默认标记类型'
}
```

#### 为行标记添加标签

```jsx {"1":5} del={"2":7-8} ins={"3":10-12}
// labeled-line-markers.jsx
<button
  role="button"
  {...props}
  value={value}
  className={buttonClassName}
  disabled={disabled}
  active={active}
>
  {children &&
    !active &&
    (typeof children === 'string' ? <span>{children}</span> : children)}
</button>
```

#### 让较长的标签单独占一行

```jsx {"1. 在这里传入 value 属性：":5-6} del={"2. 移除 disabled 与 active 状态：":8-10} ins={"3. 加上这段以在按钮内渲染子元素：":12-15}
// labeled-line-markers.jsx
<button
  role="button"
  {...props}

  value={value}
  className={buttonClassName}

  disabled={disabled}
  active={active}
>

  {children &&
    !active &&
    (typeof children === 'string' ? <span>{children}</span> : children)}
</button>
```

#### 使用类 diff 语法

```diff
+这一行会被标记为新增
-这一行会被标记为删除
这是普通的一行
```

---

```diff
--- a/README.md
+++ b/README.md
@@ -1,3 +1,4 @@
+这是一个真正的 diff 文件
-所有内容都会保持原样
 行首的空白也不会被移除
```

#### 将语法高亮与类 diff 语法结合

```diff lang="js"
  function thisIsJavaScript() {
    // 整个代码块都会按 JavaScript 高亮，
    // 同时还能给它加上 diff 标记！
-   console.log('要删掉的旧代码')
+   console.log('崭新又漂亮的代码！')
  }
```

#### 标记行内的指定文本

```js "指定文本"
function demo() {
  // 可以标记行内任意指定文本
  return '支持匹配多处相同的指定文本';
}
```

#### 正则表达式

```ts /ye[sp]/
console.log('单词 yes 和 yep 都会被标记。')
```

#### 转义斜杠

```sh /\/ho.*\//
echo "Test" > /home/test.txt
```

#### 选择行内标记类型（mark、ins、del）

```js "return true;" ins="插入" del="删除"
function demo() {
  console.log('这里演示的是 插入 和 删除 两种标记类型');
  // return 语句使用默认的标记类型
  return true;
}
```

### 自动换行

[Word Wrap](https://expressive-code.com/key-features/word-wrap/)

#### 为单个代码块配置自动换行

```js wrap
// 开启 wrap 的示例
function getLongString() {
  return '这是一个很长很长的字符串，除非容器特别宽，否则它几乎肯定塞不进可用的空间里'
}
```

---

```js wrap=false
// wrap=false 的示例
function getLongString() {
  return '这是一个很长很长的字符串，除非容器特别宽，否则它几乎肯定塞不进可用的空间里'
}
```

#### 配置换行后的缩进

```js wrap preserveIndent
// preserveIndent 的示例（默认启用）
function getLongString() {
  return '这是一个很长很长的字符串，除非容器特别宽，否则它几乎肯定塞不进可用的空间里'
}
```

---

```js wrap preserveIndent=false
// preserveIndent=false 的示例
function getLongString() {
  return '这是一个很长很长的字符串，除非容器特别宽，否则它几乎肯定塞不进可用的空间里'
}
```

## 可折叠区块

[Collapsible Sections](https://expressive-code.com/plugins/collapsible-sections/)

```js collapse={1-5, 12-14, 21-24}
// 这些样板初始化代码都会被折叠起来
import { someBoilerplateEngine } from '@example/some-boilerplate'
import { evenMoreBoilerplate } from '@example/even-more-boilerplate'

const engine = someBoilerplateEngine(evenMoreBoilerplate())

// 这部分代码默认可见
engine.doSomething(1, 2, 3, calcFn)

function calcFn() {
  // 一个代码块里可以有多个折叠区块
  const a = 1
  const b = 2
  const c = a + b

  // 这一行会保持可见
  console.log(`计算结果：${a} + ${b} = ${c}`)
  return c
}

// 从这里直到代码块结尾的内容会再次被折叠
engine.closeConnection()
engine.freeMemory()
engine.shutdown({ reason: '样板示例代码结束' })
```

## 行号

[Line Numbers](https://expressive-code.com/plugins/line-numbers/)

### 为单个代码块显示行号

```js showLineNumbers
// 这个代码块会显示行号
console.log('第 2 行向你问好！')
console.log('我在第 3 行')
```

---

```js showLineNumbers=false
// 这个代码块关闭了行号
console.log('有人吗？')
console.log('抱歉，你知道我现在在第几行吗？')
```

### 修改起始行号

```js showLineNumbers startLineNumber=5
console.log('第 5 行向你问好！')
console.log('我在第 6 行')
```
