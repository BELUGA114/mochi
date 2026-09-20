---
title: yt-dlp 入门笔记
published: 2026-08-10
description: yt-dlp 的常用参数与用法速查。
image: ""
tags: [yt-dlp, 命令行, YouTube, 视频下载]
category: 工具
draft: false
---

## 准备

仓库地址：[yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp)

依赖确认：

```bash
ffmpeg -version
```

更新：

```bash
yt-dlp -U
```

## 配置文件

路径 `%AppData%\yt-dlp\config` 或 exe 同目录下的 `config.txt`：

```bash
-f "bv*[height<=1080]+ba/b[height<=1080]"  # 选不超过1080p的最佳视频+音频，或退而选最佳单文件
--merge-output-format mp4                  # 合并输出为 MP4 容器
--embed-metadata --embed-chapters          # 嵌入元数据和章节信息
--embed-thumbnail --convert-thumbnails jpg # 嵌入封面，并统一转成 jpg
--embed-subs --sub-langs "zh.*,en.*" --convert-subs srt  # 嵌入中英文字幕，并转成 srt
--sponsorblock-remove default              # 按 SponsorBlock 移除默认类别片段（赞助、片头片尾等）
--windows-filenames --trim-filenames 150   # 文件名兼容 Windows，主体最长 150 字符
--newline                                  # 进度按新行输出，适合日志/脚本
-o "%(uploader)s/%(upload_date>%Y-%m-%d)s - %(title)s [%(id)s].%(ext)s"
# 输出路径：上传者/上传日期(YYYY-MM-DD) - 标题 [视频ID].扩展名
```

下载 1080p 视频 -> 合并 MP4 -> 嵌入封面/字幕/章节/元数据 -> 去赞助片段 -> 按频道和日期自动归档

建好之后 `yt-dlp <URL>` 就是完整流程，对所有调用生效，忽略预设配置加 `--ignore-config`。

## 选格式

### 按参数选

`-f` 的写法里，`bv*+ba/b` 展开是 `bestvideo*+bestaudio/best`：

- `bv` 是纯视频流，`ba` 是纯音频流，加 `*` 表示不限于 video-only
- `+` 表示视频流和音频流分别下载后用 ffmpeg 合并
- `/` 是"或"，前面不满足时用后面的
- 结尾的 `b` 是含音视频的单文件，作兜底

```bash
yt-dlp -F <URL>                            # 列出格式
yt-dlp -f "bv*+ba/b" <URL>                 # 默认最佳
yt-dlp -S "res:1080,vcodec:h264" <URL>     # 限 1080p，优先 H.264
yt-dlp -f "bv[height<=1080]+ba/b" <URL>    # 硬限高度
yt-dlp -S "ext" <URL>                      # 优先 mp4 容器
```

想要 mp4 又不想踩兼容问题，用 `-f "bv[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b"`，它在选流阶段就限定容器。用 `-f "bv+ba" --merge-output-format mp4` 是先挑最佳流再硬封，可能把 VP9 装进 mp4。

### 按 ID 选

`-F` 列出来的 ID 可以直接写进 `-f`，多条用 `+` 合并：

```bash
yt-dlp -f <格式ID> <<URL>>
yt-dlp -f 137+140 <URL>                 # 视频流 + 音频流
yt-dlp -f 30032+bestaudio <URL>         # ID 和选择器可以混着写
```

只写视频流 ID 会得到没有声音的文件。ID 是每个视频各自的，换视频要重新 `-F`，同一站点不同视频的可用 ID 也会不一样。

别写 `[format_id=137]` 这种过滤表达式，ID 是纯数字时它不生效，会报 `Requested format is not available`，直接用裸 ID。

## 音频

```bash
yt-dlp -x --audio-format mp3 --audio-quality 0 <URL>   # 转 mp3，0 是最高
yt-dlp -f "ba[ext=m4a]/ba" -x <URL>                    # 直取 m4a，不重编码，最快
yt-dlp -x --audio-format best <URL>                    # 不转码，只抽流
```

`--audio-format` 可选 `best` / `aac` / `alac` / `flac` / `m4a` / `mp3` / `opus` / `vorbis` / `wav`，指定 `aac` 得到 .m4a，`vorbis` 得到 .ogg。

YouTube 的音轨最高 256 kbps，转 320K mp3 就是最高。

## 字幕

```bash
# 列出该视频可用的字幕及语言代码
yt-dlp --list-subs <URL>

# 下载视频，并下载简体中文、繁体中文、英文人工字幕，转成 SRT 后嵌入视频
yt-dlp --write-subs --sub-langs "zh-Hans,zh-Hant,en" --convert-subs srt --embed-subs <URL>

# 下载视频，并额外下载英文自动生成字幕
yt-dlp --write-auto-subs --sub-langs "en" <URL>

# 不下载视频，只下载英文自动字幕，转成 SRT，并按“标题.srt”保存
yt-dlp --skip-download --write-auto-subs --convert-subs srt -o "%(title)s.%(ext)s" <URL>
```

## 播放列表与批量

```bash
yt-dlp --batch-file <URL>s.txt <URL>                    # 文件里每行一个 <URL>
yt-dlp --download-archive archive.txt <URL>             # 下过的记进文件，重跑自动跳过
yt-dlp --playlist-items 1-10,15,20- <URL>               # 只下其中几集
yt-dlp --dateafter 20250101 <URL>                       # 只下这个日期之后的
yt-dlp --match-filters "duration>120 & !is_live" <URL>  # 只下时长超过 120 秒且非直播的视频
yt-dlp --flat-playlist --print "%(playlist_index)s`t%(title)s" <URL>   # 只看清单不下载
```

频道归档用 `--download-archive` 配 `-o "%(playlist_index)03d - %(title)s.%(ext)s"`，定时跑一次就是增量下载。

## 搜索与 cookies

```bash
# YouTube 搜索前 10 个结果，只列出标题和链接
yt-dlp "ytsearch10:关键词" --flat-playlist --print "%(title)s | %(url)s"

# YouTube 搜索“关键词”，取前 10 个结果，最多只下载其中 3 个
yt-dlp "ytsearch10:关键词" --max-downloads 3

# YouTube 搜索“关键词”，取按上传日期排序的前 5 个结果并下载
yt-dlp "ytsearchdate5:关键词"

# 下载 YouTube 收藏夹（:ytfav），用 Firefox 的 cookies 完成登录认证
yt-dlp ":ytfav" --cookies-from-browser firefox
```

同类的还有 `:ytwatchlater`、`:ythistory`、`:ytrec`，都需要 cookies。

配置里加 `--default-search "ytsearch1:"` 之后可以直接 `yt-dlp 关键词`。

cookies 两种给法：

```bash
yt-dlp --cookies-from-browser edge <URL>
yt-dlp --cookies cookies.txt <URL>
```

Chrome 开着时可能读不到它的 cookie 库，Edge 和 Firefox 稳一些。手动导出用浏览器扩展，Chrome 用 ExportThisCookies，Firefox 用 Export Cookies。

## 切片、直播、去赞助

```bash
yt-dlp --download-sections "*10:00-15:00" <URL>   # 需要 ffmpeg
yt-dlp --download-sections "*from-2:30" <URL>     # 从 2:30 到结尾
yt-dlp --split-chapters <URL>                     # 按章节切成多个文件
yt-dlp --live-from-start <URL>                    # 直播从头录
yt-dlp --wait-for-video 60 <URL>                  # 等开播，每 60 秒探一次
yt-dlp -N 8 <URL>                                 # 并发分片，提速明显

yt-dlp --sponsorblock-remove default <URL>        # 去掉赞助片段
yt-dlp --sponsorblock-mark all <URL>              # 只标记成章节，不删
```

`default` 等于 `all,-filler`。需要能连上 sponsor.space。

## 代理

```bash
yt-dlp --proxy http://127.0.0.1:10086 <URL>
yt-dlp --proxy socks5://127.0.0.1:10086 <URL>
yt-dlp --proxy "" <URL>                        # 强制直连
```

yt-dlp 不读代理环境变量，只认 `--proxy`。

YouTube 报 403 时先试 `--extractor-args "youtube:player_client=web_safari"`，可选值会随 Google 的改动变，遇到问题去 issue 区看当下推荐值，有些站点要 `--impersonate chrome` 才能过。

## 控制台里的中文

控制台显示的中文标题可能是乱码，但文件名和文件内容本身没问题。

只要中文标题就写进文件再读：

```bash
yt-dlp --simulate --print-to-file "%(title)s" title.txt <URL>
```

## 其他注意

- PowerShell 里 `%` 不用转义，cmd 里才要写成 `%%`
- 参数里有 `[` `]` `*` 时加引号
- 输出模板里的 `/` 会建子目录
- 文件名太长用 `--trim-filenames`，非法字符用 `--windows-filenames`
- 常见字段：`%(title)s` 标题，`%(id)s` 视频 ID，`%(ext)s` 扩展名，`%(uploader)s` 上传者，`%(upload_date)s` 上传日期，`%(playlist_index)s` 列表序号，`%(height)s` 分辨率高度
