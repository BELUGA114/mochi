---
title: XHTTP 原理、配置字段与玩法
published: 2026-08-13
description: 对 XHTTP 官方文档和社区讨论以及源码的研读与实践：三种模式、XMUX 与请求混淆的取舍，过 CF 与 Nginx 前置以及上下行分离、Browser Dialer、FinalMask 混搭等玩法。
image: ""
tags: [VPS, Xray, XHTTP, REALITY, Cloudflare]
category: 网络
draft: false
---

## 前言

本文来自对 [XHTTP: Beyond REALITY](https://github.com/XTLS/Xray-core/discussions/4113) 和社区讨论以及 Xray-core v26.6.1 源码的研读和实践。

配置基于 Xray v26.9.8 的字段名，示例统一使用以下占位：`domain.com` 为主域名，`cf1.domain.com` / `cf2.domain.com` / `cf3.domain.com` 为开启橙云的子域，`/yourpath` 为 XHTTP path，`vpsadmin` 账户运行 Xray，证书目录 `~/xray_cert`。

## 优势

- XMUX：H2/H3 的 0-RTT 多路复用控制
- 上下行分离：服务端仅按 path 中随机生成的 UUID 关联上下行，两个方向可以走完全不同的入口
- 请求元数据混淆：会话 ID、seq、上行数据的载体（path / query / header / cookie）与形态都可配置、随机化，避免在 CDN 里留下固定模式
- `extra` 分享机制：`host`、`path`、`mode` 以外的所有参数可整块塞进分享链接，由服务提供者下发
- Browser Dialer：用真浏览器的网络栈和 TLS 指纹发请求
- 无需 gRPC 库，性能更好，下行是独立 GET 不受 CDN 对 gRPC 的限速，相比 WS/HTTPUpgrade，没有 `ALPN = http/1.1` 的特征

## 模式

| 模式       | 上行                          | 下行     | HTTP 请求数 | 说明                         |
| ---------- | ----------------------------- | -------- | ----------- | ---------------------------- |
| packet-up  | 分包`POST /path/UUID/seq`     | GET 流式 | N 个        | 兼容性最强                   |
| stream-up  | 流式`POST /path/UUID`         | GET 流式 | 2 个        | 上行不牺牲效率，上下行可分离 |
| stream-one | 单个`POST /path/`，响应即下行 | 同一请求 | 1 个        | 最接近普通请求，REALITY 默认 |

**"mode" 四选一，客户端、服务端默认值都是 "auto"：**

- "auto" - 客户端：一律 packet-up，REALITY 时 stream-one（有 `downloadSettings` 时 stream-up）/ 服务端：同时接受三种模式
- "packet-up" - 客户端：分包上行 + 流式下行（单独的子连接）/ 服务端：仅接受 packet-up
- "stream-up" - 客户端：流式上行 + 流式下行（另一条子连接）/ 服务端：仅接受 stream-up 和 stream-one
- "stream-one" - 客户端：流式上行 + 流式下行（同一条子连接），不能有 downloadSettings / 服务端：仅接受 stream-one

**模式细节**：

- packet-up 的 seq 从 0 开始，必须发完上一个 POST 的 body 再发下一个；乱序到达由服务端按 seq 重组，默认最多缓存 30 个，超限断连。会话 ID 与 seq 默认拼在 path（`/yourpath/UUID/seq`），开启混淆后也可挪到 query、header 或 cookie
- stream-up / stream-one 的上行默认带 `Content-Type: application/grpc` 伪装（配置 `noGRPCHeader` 可关闭），加上这个 header 后 H2 流式上行可穿透 CF，需面板开 gRPC 支持
- stream-one 的 path 若末尾无 `/` 会自动补上
- 下行响应头与 packet-up 一致；stream-one 会出现以 SSE 回应 gRPC 的情况，遇到问题可尝试配置 `noSSEHeader`

**packet-up 专属参数**：

- `scMaxEachPostBytes`：每个 POST 最多携带的字节数，默认 1000000（1MB），应小于中间盒允许的最大值，服务端会拒绝超限 POST
- `scMinPostsIntervalMs`：仅客户端，单个代理请求内 POST 的最小间隔，默认 30ms
- `scMaxBufferedPosts`：仅服务端，最多缓存的 POST 数，默认 30

前两项建议填范围字符串（如 `"500000-1000000"`）每次随机，减少指纹，三者均基于单个代理请求独立计数。

**stream-up 专属参数**：

- `scStreamUpServerSecs`：仅服务端，默认 `"20-80"` 随机，每隔该时长向 stream-up 上行 POST 的响应方向写 `xPaddingBytes` 个字节保活（前提是请求携带 padding，默认总是携带），设 `-1` 停发保活数据

## HTTP 版本（H1 / H2 / H3）

三种 mode 决定工作模式，ALPN 决定底层 HTTP 版本，它们之间是解耦、可以任意组合的；ALPN 由客户端单方面决定：

| 客户端配置                               | 结果     |
| ---------------------------------------- | -------- |
| 只要有`realitySettings`                  | H2       |
| 无`tlsSettings` 也无 REALITY             | HTTP/1.1 |
| `alpn` 为 `["http/1.1"]`                 | HTTP/1.1 |
| `alpn` 为 `["h3"]`                       | H3       |
| 其余情况（不写`alpn`、写多项、写别的值） | H2       |

**注意：**

- H3 的条件是 `alpn` 仅有一项且值为 `h3`，`"alpn": ["h3", "h2"]` 得到的是 H2，客户端不会优先 H3、失败退回 H2
- 服务端 `alpn` 为 `["h3"]` 时才监听 UDP/QUIC，否则一律监听 TCP
- 套 CF 时客户端 H3 会被降成 H1/H2 回源，服务端无需监听 UDP

## XMUX

XMUX 仅在客户端设置，H2/H3 均为 0-RTT 多路复用，XMUX 是控制它们的核心接口：

| 参数               | 含义                                                                | 全 0 时的默认值    |
| ------------------ | ------------------------------------------------------------------- | ------------------ |
| `maxConcurrency`   | 每条连接最多同时承载的代理请求数，达到后建新连接                    | 0（不限）          |
| `maxConnections`   | 最多连接数，达到前每个新请求开新连接，之后开始复用                  | 3（固定）          |
| `cMaxReuseTimes`   | 一条连接最多被复用几次                                              | 0（不限）          |
| `hMaxRequestTimes` | 一条连接累计承载的 HTTP 请求上限（对付 Nginx 每连接 1000 请求上限） | `"600-900"` 随机   |
| `hMaxReusableSecs` | 一条连接的最长复用时长（对付 Nginx 一小时上限）                     | `"1800-3000"` 随机 |
| `hKeepAlivePeriod` | 空闲时 H2/H3 保活间隔（秒），0 为 Chrome H2 45s / quic-go 10s       | 0                  |

多线程测速前可设 `"maxConcurrency": 1`，只用一条底层连接复用到底可以设 `"maxConnections": 1`，日常可保持全 0。

**注意：**

- `maxConcurrency` 与 `maxConnections` 冲突（都大于 0 直接报错），只能二选一
- `hKeepAlivePeriod` 是唯一不允许填范围的项（该值取随机本身才是特征），且允许负数（-1 关闭空闲保活）
- 填了任意一项后其余项就没有默认值了，须全部显式填写
- packet-up 循环 POST 超过 `hMaxRequestTimes` / `hMaxReusableSecs` 时会自动切换到另一条连接，占一次 reuseTimes 但不占 concurrency
- 使用 XHTTP 时不要启用 mux.cool，新版服务端已检查，只接受纯 XUDP

## 请求混淆

padding 默认放在 `Referer: /yourpath?x_padding=XXXX...`，这些在 CDN、反代的访问日志与 WAF 规则里都是显眼的模式，而混淆参数可以把元数据挪走并随机化：

| 参数                   | 作用                                                                       | 默认值                                      |
| ---------------------- | -------------------------------------------------------------------------- | ------------------------------------------- |
| `xPaddingBytes`        | padding 长度范围（不可关闭，填 0 或负数会报错）                            | 100-1000 随机                               |
| `xPaddingObfsMode`     | 总开关，开启后 padding 的位置与样式按下列参数走                            | `false`（固定 `Referer` + `x_padding`）     |
| `xPaddingPlacement`    | padding 放哪：`queryInHeader` / `cookie` / `header` / `query`              | `queryInHeader`                             |
| `xPaddingMethod`       | padding 内容：`repeat-x`（重复 `X`）/ `tokenish`（随机 Base62）            | `repeat-x`                                  |
| `xPaddingKey`          | query / cookie 的键名                                                      | `x_padding`                                 |
| `xPaddingHeader`       | 承载 query 的头名（例如`Referer`、`Origin` 等）                            | `X-Padding`                                 |
| `sessionIDPlacement`   | 会话 ID 放哪：`path` / `query` / `header` / `cookie`                       | `path`                                      |
| `sessionIDKey`         | 非 path 放置时承载会话 ID 的键名（头名 / 参数名 / cookie 名）              | `X-Session` / `x_session`（由放置位置决定） |
| `sessionIDTable`       | 会话 ID 的字符表（预置`Base62`、`Alphabet`、`hex` 等）                     | 空（用 UUID）                               |
| `sessionIDLength`      | 会话 ID 的长度范围                                                         | 空（用 UUID）                               |
| `seqPlacement`         | seq 放哪：`path` / `query` / `header` / `cookie`                           | `path`                                      |
| `seqKey`               | 非 path 放置时承载 seq 的键名（头名 / 参数名 / cookie 名）                 | `X-Seq` / `x_seq`（由放置位置决定）         |
| `uplinkDataPlacement`  | packet-up 上行数据放哪：`body` / `header` / `cookie`（后两者仅 packet-up） | `body`                                      |
| `uplinkDataKey`        | 非 body 放置时承载上行数据的键名（头名 / cookie 名）                       | `X-Data` / `x_data`（由放置位置决定）       |
| `uplinkChunkSize`      | 数据放 header / cookie 时每块编码后的大小                                  | header 3-4KB / cookie 2-3KB                 |
| `uplinkHTTPMethod`     | 上行 HTTP 方法，`GET` 仅 packet-up 可用                                    | `POST`                                      |
| `serverMaxHeaderBytes` | 服务端接受的最大请求头字节数                                               | 8192                                        |

`extra` 字段用于向客户端分享配置，服务端只认自己 `xhttpSettings` 里的同名参数：

- **两端须一致：** `padding` 的 6 项以及 `sessionIDPlacement`、`sessionIDKey`、`seqPlacement`、`seqKey`、`uplinkDataPlacement`、`uplinkDataKey`。服务端会校验参数，两端不一致时请求会被 400 拒绝
- **仅客户端：** `sessionIDTable`、`sessionIDLength`、`uplinkHTTPMethod`、`uplinkChunkSize`、`noGRPCHeader`、`scMinPostsIntervalMs`
- **仅服务端：** `serverMaxHeaderBytes`、`scStreamUpServerSecs`、`scMaxBufferedPosts`、`noSSEHeader`

`scMaxEachPostBytes` 是单向约束，客户端按自己的值分包，服务端只拿自己的 `To` 做上限，不小于客户端即可。

padding 默认是以 `Referer: /yourpath?x_padding=...` 的形式发出，如果 CDN/WAF 针对该形式 403 时优先把 padding 放进 header 尝试。

:::note[混淆参数随着封锁逐步加入]
最先是 CDNVideo 只要请求包含 `x_padding=XXXXX` 参数，就抛出 403([issue #4346](https://github.com/XTLS/Xray-core/issues/4346#issuecomment-3545201732))，于是有了换键名、换字符表（`tokenish`）和挪位置。

接着 Yandex Cloud、VK Cloud 等禁掉 POST（[Yandex 文档](https://yandex.cloud/en/docs/cdn/operations/resources/configure-http)），于是 `uplinkHTTPMethod` 允许改用 PUT、PATCH；再往后有 CDN 按 UUID 的 `8-4-4-4-12` 形状封 session ID（[issue #6264](https://github.com/XTLS/Xray-core/issues/6264)），于是 `sessionIDTable`、`sessionIDLength` 能将其伪装成普通 token。
:::

Xray 的思路是不应把手里的牌一下子打完([issue #19](https://github.com/XTLS/BBS/issues/19))，所以混淆默认关闭且默认值保守，等某个特征真被针对了再使用对应参数，防止过度配置本身成了新特征，日常使用保持默认值即可。

## 客户端 extra 模板

示例为 packet-up 模式，覆盖 `extra` 可用的全部字段，可按需更改或删掉走默认：

```json title="客户端"
"xhttpSettings": {
  "path": "/yourpath",
  "extra": {
    // 追加的自定义请求头
    "headers": { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    // 两端一致：padding 与 placement / key
    "xPaddingBytes": "100-1000",
    "xPaddingObfsMode": true,
    "xPaddingPlacement": "queryInHeader",
    "xPaddingMethod": "tokenish",
    "xPaddingKey": "x",
    "xPaddingHeader": "Origin",
    "sessionIDPlacement": "query",
    "sessionIDKey": "s",
    "seqPlacement": "query",
    "seqKey": "q",
    "uplinkDataPlacement": "header",
    "uplinkDataKey": "X-Data",
    // 仅客户端：会话 ID 形态、上行形态与分包节奏
    "sessionIDTable": "Base62",
    "sessionIDLength": "12-20",
    "uplinkChunkSize": "2000-3000",
    "uplinkHTTPMethod": "GET",
    "noGRPCHeader": false,
    "scMaxEachPostBytes": "4000-8000",
    "scMinPostsIntervalMs": "10-50",
    // 仅客户端：XMUX，填了任意一项后须全部显式填写
    "xmux": {
      "maxConcurrency": 0, "maxConnections": 0, "cMaxReuseTimes": 0,
      "hMaxRequestTimes": 0, "hMaxReusableSecs": 0, "hKeepAlivePeriod": 0
    }
    // "downloadSettings": { ... }   // 上下行分离时的完整下行 streamSettings
  }
}
```

**注意：**

- `downloadSettings.xhttpSettings` 里也可写 `extra`，与上行的 `extra` 完全一致，XMUX 和请求混淆的字段与规则全部适用
- **下行配置不继承上行的任何配置**，XMUX 参数 roll 出的具体数也是各自独立随机的，随时间推移上下行复用完全不对称
- 数据放 header 时要相应调大 `serverMaxHeaderBytes`（如 16384，过 CDN 还要留意中间盒的请求头上限）
- `tokenish` 生成随机 Base62 串，按 HPACK huffman 编码后长度落在 `xPaddingBytes` 区间内，服务端校验同样按 huffman 长度算，比一串 `X` 更像真实数据
- `queryInHeader` 仍是把 padding 塞进某个头（可自定义，默认 `Referer`）的 URL query 里，对 CF 兼容性最好；`cookie` / `header` / `query` 则完全离开 URL

## 选型

XTLS/Vision 只在 TCP+TLS/REALITY 下可用：

|                  | RAW + REALITY + Vision            | XHTTP + REALITY                      |
| ---------------- | --------------------------------- | ------------------------------------ |
| 新连接延迟       | 每条代理连接一次 TCP+TLS 握手     | XMUX 复用，新请求 0-RTT，延迟更低    |
| 多线程测速       | 更强，每条连接独立拥塞窗口        | 不如 Vision，除非`maxConcurrency: 1` |
| CPU / 吞吐       | Linux 下自动 Splice，内核直接转发 | 无 Splice，H2 帧处理走用户态         |
| 上下行分离       | 没有                              | 有（packet-up/stream-up）            |
| 中间盒/CDN       | 不可能                            | 本身为此设计                         |
| 抗单连接时序分析 | Vision 内层握手随机填充           | padding + XMUX 随机化 + 多流混合     |

| 组合                                   | 适用场景                                                  |
| -------------------------------------- | --------------------------------------------------------- |
| Vision + REALITY 直连                  | 要单流拉满带宽、服务器 CPU 不富裕、Linux环境              |
| XHTTP + REALITY 直连                   | 网页浏览、有大量小连接、要上下行分离、要过 CDN 或前置反代 |
| 上行 XHTTP+TLS+CDN，下行 XHTTP+REALITY | 去程差、回程好                                            |
| 上行 XHTTP+REALITY，下行 XHTTP+TLS+CDN | 去程好、回程差                                            |
| XHTTP+TLS+CDN                          | 去程回程都差或无法直连                                    |

## 玩法与示例配置

以下示例共用基线结构：客户端 SOCKS 入站 + VLESS 出站，服务端 VLESS 入站 + freedom 出站。

### 基线：XHTTP + REALITY 直连

```json title="服务端"
{
  "inbounds": [
    {
      "listen": "0.0.0.0",
      "port": 443,
      "protocol": "vless",
      "settings": {
        "users": [{ "id": "你的UUID" }],
        "decryption": "none"
      },
      "streamSettings": {
        "method": "xhttp",
        "xhttpSettings": { "path": "/yourpath" }, // mode 不填 = auto，三种模式都收
        "security": "reality",
        "realitySettings": {
          "target": "www.some-site.com:443",
          "serverNames": ["www.some-site.com"],
          "privateKey": "PrivateKey",
          "shortIds": [""]
        }
      }
    }
  ],
  "outbounds": [{ "protocol": "freedom" }]
}
```

```json title="客户端"
{
  "inbounds": [
    {
      "listen": "127.0.0.1",
      "port": 10808,
      "protocol": "socks",
      "settings": { "udp": true }
    }
  ],
  "outbounds": [
    {
      "protocol": "vless",
      "settings": {
        "address": "你的VPS_IP",
        "port": 443,
        "id": "你的UUID",
        "encryption": "none"
      },
      "streamSettings": {
        "method": "xhttp",
        "xhttpSettings": { "path": "/yourpath" },
        "security": "reality",
        "realitySettings": {
          "serverName": "www.some-site.com",
          "password": "xray x25519 -i 私钥 得到的 Password",
          "shortId": "",
          "fingerprint": "chrome",
          "spiderX": "/"
        }
      },
      // XHTTP 不能开 mux.cool；concurrency 填负数关掉 TCP 复用，XUDP 走聚合隧道
      "mux": { "enabled": true, "concurrency": -1, "xudpConcurrency": 16 }
    }
  ]
}
```

### 过 CDN（TLS）

cf1.domain.com 开启橙云、CF 面板 SSL 模式为 Full (strict)，服务端持证书。

```json title="服务端"
"streamSettings": {
  "method": "xhttp",
  "xhttpSettings": { "path": "/yourpath" },
  "security": "tls",
  "tlsSettings": {
    "alpn": ["h2", "http/1.1"],
    "certificates": [{
      "certificateFile": "/home/vpsadmin/xray_cert/xray.crt",
      "keyFile": "/home/vpsadmin/xray_cert/xray.key"
    }]
  },
  // CF 回源必带 CF-Connecting-IP，用它当哨兵头决定是否信任 XFF
  "sockopt": { "trustedXForwardedFor": ["CF-Connecting-IP"] }
}
```

客户端 H2 版，`address` 填优选 IP，`serverName` 填域名：

```json title="客户端"
{
  "settings": {
    "address": "优选 IP",
    "port": 443,
    "id": "你的UUID",
    "encryption": "none"
  },
  "streamSettings": {
    "method": "xhttp",
    "xhttpSettings": { "path": "/yourpath" },
    "security": "tls",
    "tlsSettings": { "serverName": "cf1.domain.com", "fingerprint": "chrome" }
  }
}
```

使用 H3 需显式指定 `alpn`：

```json title="客户端"
"tlsSettings": { "serverName": "cf1.domain.com", "alpn": ["h3"], "fingerprint": "chrome" }
```

使用 H2 且要流式上行时显式指定 `mode`（需 CF 面板开 gRPC 支持）：

```json title="客户端"
"xhttpSettings": {
  "path": "/yourpath",
  "mode": "stream-up"   // 或 stream-one
}
```

有的 CDN 会限速 stream-one 但不限 stream-up，遇到断流或降速尝试切换模式或调整混淆参数；若 CDN 对请求体大小敏感，可调分包节奏：

```json title="客户端"
"xhttpSettings": {
  "path": "/yourpath",
  "extra": {
    "scMaxEachPostBytes": "500000-1000000",   // 需小于 CDN 允许的最大请求体
    "scMinPostsIntervalMs": "10-50"
  }
}
```

客户端连接 CF 边缘 IP，CF 用边缘证书握手，按 Host 回源到 VPS，验证 Origin 证书后转发给 Xray。

CF 会掐断下行 100 秒无实际数据的 HTTP，代理长连接需应用层保活，比如使用 sshd 的 `ClientAliveInterval`。

对于 Fastly、Gcore、CloudFront 这类非 CF 的 CDN 时，`trustedXForwardedFor` 需使用对应 CDN 每次回源都稳定携带的头（比如Fastly 的 `Fastly-Client-IP`，CloudFront 的 `CloudFront-Viewer-Address`），并确认 CDN 把真实客户端 IP 放进了 `X-Forwarded-For`。

常见问题：

1. 服务端日志报 `invalid x_padding length:0`、请求被 400。优先考虑是 CDN 未将 URL 的 query string 透传回源，例如 CloudFront 的缓存策略默认不带 query string，需在 Cache Policy 里把 query string 设为转发全部。

2. CDN 或 WAF 识别并拦截 `?x_padding=` 导致 403，请求无法回源。考虑把 padding 挪出 URL，开启 `xPaddingObfsMode` 后把 `xPaddingPlacement` 设为 `cookie` 或 `header`，或尝试更改 `xPaddingKey`，做法见 [把元数据搬出 URL](#元数据搬出-url)。

### Nginx 前置（TLS）

Nginx 持真证书监听 443，XHTTP 入站监听本地明文：

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name cf1.domain.com;
    ssl_certificate     /etc/ssl/fullchain.pem;
    ssl_certificate_key /etc/ssl/privkey.pem;

    location /yourpath {
        grpc_pass grpc://127.0.0.1:1234;          # stream-up / stream-one 用这个
        grpc_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        grpc_set_header X-From-Front 1;           # 哨兵头，供 trustedXForwardedFor 匹配
        grpc_read_timeout 1h;
        grpc_send_timeout 1h;
    }

    location / { root /var/www/html; }            # 其余路径是正常网站
}
```

Xray 入站：

```json title="服务端"
{
  "listen": "127.0.0.1",
  "port": 1234,
  "protocol": "vless",
  "settings": { "users": [{ "id": "你的UUID" }], "decryption": "none" },
  "streamSettings": {
    "method": "xhttp",
    "xhttpSettings": { "path": "/yourpath" },
    "sockopt": { "trustedXForwardedFor": ["X-From-Front"] }
  }
}
```

TLS 在 Nginx 终结，按 path 把 `/yourpath` 以 h2c 转发本地 1234，其余路径当普通网站服务。防御主动探测，TLS 指纹是 Nginx 的而非 Go 的。

TLS 版本由 Nginx 决定，特殊情况可回退 TLS 1.2，用于规避审查方对来自某些机房的 TLS 1.3 进行阻断的策略。

packet-up 模式下 `grpc_pass` 不适用，更换普通反代并关闭缓冲：

```nginx
location /yourpath {
    proxy_pass http://127.0.0.1:1234;
    proxy_http_version 1.1;
    proxy_buffering off;              // 下行必须关，否则流式下行退化
    proxy_request_buffering off;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-From-Front 1;
    proxy_read_timeout 1h;
}
```

客户端不出现新块，沿用 [上文](#过-cdntls) 的字段。

如需使用 H3，使用 Nginx ≥ 1.25 并监听 QUIC 即可，回源的 location 不变：

```nginx
listen 443 quic reuseport;   # H3，需 Nginx ≥ 1.25
listen 443 ssl;
http2 on;
http3 on;
add_header Alt-Svc 'h3=":443"; ma=86400';
```

客户端 `alpn` 指定 `["h3"]`。

Caddy 默认开启 H3，`reverse_proxy` 到同一个入站即可。

### Cloudflare Worker / Snippet 反代前置

不想让源站域名直接开橙云回源，可以用 Worker（或更轻量的 Snippet）把请求改写到后端域名再转发，客户端连接 Worker 路由绑定的域名：

```js title="Cloudflare Worker"
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const backends = ["b1.origin.com", "b2.origin.com"]; // 后端域名，多填即随机挑
    url.hostname = backends[Math.floor(Math.random() * backends.length)];
    return fetch(new Request(url, request));
  },
};
```

CF 面板里给 Worker 绑定 `front.domain.com/yourpath*` 路由，客户端 `address`/`serverName`/`host` 指向 `front.domain.com`，path、UUID、padding 原样透传。

前置域名与源站解耦，适用于随机挑后端、给已被阻断的源站套层 CF 或希望把前置逻辑与回源分开的情况，受 Worker 的 CPU 与子请求配额限制。

### Cloudflare Argo 隧道（cloudflared 内网穿透）

前面几种过 CDN 的方案都要求源站有公网 IP、且要监听端口。依赖 Argo 隧道允许源站无监听端口，公网 IP 和证书。

适合 NAT VPS、无 DDNS 且只有动态 IPv6 的机器、回源端口受限或源站 IP 无法直连的情况。

XHTTP 入站监听本地明文，由 cloudflared 的 ingress 按域名直接转发：

```json title="服务端"
{
  "listen": "127.0.0.1",
  "port": 1234,
  "protocol": "vless",
  "settings": { "users": [{ "id": "你的UUID" }], "decryption": "none" },
  "streamSettings": {
    "method": "xhttp",
    "xhttpSettings": { "path": "/yourpath" }
  }
}
```

cloudflared 固定隧道配置：

```yaml title="~/.cloudflared/config.yml"
tunnel: 你的隧道ID
credentials-file: /home/vpsadmin/.cloudflared/你的隧道ID.json
protocol: auto # 隧道到 CF 边缘的传输，优先尝试 QUIC(UDP 7844)，异常时自动回落 H2，如已确定 UDP 被封锁、或环境对 QUIC 支持不佳，建议直接指定为 http2
ingress:
  - hostname: cf1.domain.com
    service: http://127.0.0.1:1234
    originRequest:
      http2Origin: true # 回源本地入站用 H2，XHTTP 需要
  - service: http_status:404
```

客户端沿用 [过 CDN（TLS）](#过-cdntls) 的字段，`serverName` 与 `host` 填隧道绑定的 `cf1.domain.com`。

**注意：**

- 必须用固定（命名）隧道，`trycloudflare` 临时隧道不支持 XHTTP
- 回源经隧道只有 H2，TLS 由 CF 边缘和隧道负责，Xray 入站明文 h2c
- 一条隧道可按 hostname 分流给多个入站，也能和 Worker 前置配合使用

### 上下行分离

`downloadSettings` 是一套完整的 `streamSettings` 外加 `address`/`port`，`method` 必须为 `"xhttp"`（不可省略），`security` 可为 `"tls"` 或 `"reality"`。

`sockopt` 项也可被分享，上行 `sockopt` 设 `"penetrate": true` 可覆盖下行，适合使用 `mark` 的情况。

#### 同一 CDN 上行 IPv4 H2，下行 IPv6 H3

只改客户端：

```json title="客户端"
"streamSettings": {
  "method": "xhttp",
  "security": "tls",
  "tlsSettings": { "serverName": "cf1.domain.com", "fingerprint": "chrome" },
  "xhttpSettings": {
    "path": "/yourpath",
    "mode": "stream-up",    // 不能使用 stream-one
    "extra": {
      "downloadSettings": {
        "address": "优选 IPv6",
        "port": 443,
        "method": "xhttp",
        "security": "tls",
        "tlsSettings": { "serverName": "cf1.domain.com", "alpn": ["h3"], "fingerprint": "chrome" },
        "xhttpSettings": { "path": "/yourpath" }   // path 必须一致
      }
    }
  }
}
```

客户端随机生成 UUID，上行 `POST /yourpath/UUID` 走 IPv4 的 H2 到边缘 IP-A，下行 `GET /yourpath/UUID` 走 IPv6 的 QUIC H3 到边缘 IP-B。两个方向的源 IP、目标 IP、四层协议、HTTP 版本均不同。服务端按 UUID 把两半缝合，30 秒内没缝上就终止会话，基于单条连接的检测只能看到半条流。

#### 上行下行不同 CDN

上行和下行使用两家不同的 CDN。例如上行套 CF，下行套另一家 CDN：

```json title="客户端"
"streamSettings": {
  "method": "xhttp",
  "security": "tls",
  "tlsSettings": { "serverName": "cf1.domain.com", "fingerprint": "chrome" },
  "xhttpSettings": {
    "path": "/yourpath",
    "mode": "stream-up",
    "extra": {
      "downloadSettings": {
        "address": "另一家 CDN 的 IP",
        "port": 443,
        "method": "xhttp",
        "security": "tls",
        "tlsSettings": { "serverName": "b.other-cdn.com", "fingerprint": "chrome" },
        "xhttpSettings": { "path": "/yourpath" }
      }
    }
  }
}
```

两家 CDN 按 SNI 回源到同一台 VPS 的同一个 XHTTP 入站、`path` 一致，按 UUID 缝合。两个方向所属的 CDN 基础设施不同，任何一方手里都只有半条流。

#### 同域域前置

三个地址字段在一次 XHTTP over CDN 的请求里互相独立：

| 字段                     | 是什么                               | 谁能看见                    | 决定什么           |
| ------------------------ | ------------------------------------ | --------------------------- | ------------------ |
| `address`                | 实际拨号目标                         | 链路上所有人                | 包发到哪个 IP      |
| `tlsSettings.serverName` | TLS ClientHello 的 SNI               | 链路上所有人，可用 ECH 加密 | CDN 用哪张证书握手 |
| `xhttpSettings.host`     | HTTP Host 头（H2/H3 为`:authority`） | TLS 加密，只有 CDN 能看见   | CDN 回源到哪台机器 |

SNI 与 Host 不一致即域前置，两者是同一 zone 内不同子域即同域域前置。主流商业级 CDN 均已全面禁止未经授权的跨 zone 域前置，所以采用同域域前置。

cf1 上行、cf2 下行，cf3 为共同 Host，均开启橙云并指向同一 VPS：

```json title="客户端"
"streamSettings": {
  "method": "xhttp",
  "security": "tls",
  "tlsSettings": { "serverName": "cf1.domain.com", "fingerprint": "chrome" },
  "xhttpSettings": {
    "host": "cf3.domain.com",       // 客户端发送优先级 host > serverName > address
    "path": "/yourpath",
    "mode": "stream-up",
    "extra": {
      "downloadSettings": {
        "address": "优选 IP",
        "port": 443,
        "method": "xhttp",
        "security": "tls",
        "tlsSettings": { "serverName": "cf2.domain.com", "alpn": ["h3"], "fingerprint": "chrome" },
        "xhttpSettings": { "host": "cf3.domain.com", "path": "/yourpath" }
      }
    }
  }
}
```

两条 TLS 握手 SNI 分别是 cf1 和 cf2，两个方向的 Host 都是 cf3，CF 按 cf3 回源。

当 cf1 和 cf2 橙云均指向同一台 VPS 时，不填 `host` 也可以，各方向按 SNI 回源至同一台机器同一 path，按 UUID 缝合。需要 `host` 的场景：源站前有 Nginx 按 `server_name` 分流、只想为一个域名配回源规则、或想让两个方向走完全一样的回源逻辑。

#### 上行去程优 + 下行回程优，非对称 XMUX

```json title="客户端"
"xhttpSettings": {
  "path": "/yourpath",
  "mode": "stream-up",
  "extra": {
    // 上行数据少，全挤在一条底层连接上（0 = 无默认值，显式写全）
    "xmux": {
      "maxConcurrency": 0, "maxConnections": 1, "cMaxReuseTimes": 0,
      "hMaxRequestTimes": 0, "hMaxReusableSecs": 0, "hKeepAlivePeriod": 0
    },
    "downloadSettings": {
      "address": "回程优的 IP",
      "port": 443,
      "method": "xhttp",
      "security": "tls",
      "tlsSettings": { "serverName": "cf1.domain.com", "fingerprint": "chrome" },
      "xhttpSettings": {
        "path": "/yourpath",
        "extra": {
          // 下行数据多，每条底层连接只跑一个请求，摊到多条链路
          "xmux": {
            "maxConcurrency": 1, "maxConnections": 0, "cMaxReuseTimes": 0,
            "hMaxRequestTimes": 0, "hMaxReusableSecs": 0, "hKeepAlivePeriod": 0
          }
        }
      }
    }
  }
}
```

上行所有 POST 复用同一条 TCP，省握手；下行每个 GET 各开一条 TCP，避开单连接拥塞窗口和队头阻塞；两个方向各走最优路径。

#### 上/下行 REALITY 直连 + 下/上行过 CDN

```json title="服务端"
{
  "inbounds": [
    // XHTTP 明文入站，监听本地
    {
      "listen": "127.0.0.1",
      "port": 1234,
      "protocol": "vless",
      "settings": { "users": [{ "id": "你的UUID" }], "decryption": "none" },
      "streamSettings": {
        "method": "xhttp",
        "xhttpSettings": { "path": "/yourpath" },
        "sockopt": { "trustedXForwardedFor": ["CF-Connecting-IP"] }
      }
    },
    // 入口 A：REALITY 监听 443，非法 VLESS 首包回落到 1234
    {
      "listen": "0.0.0.0",
      "port": 443,
      "protocol": "vless",
      "settings": {
        "users": [{ "id": "一个用不到的UUID" }],
        "decryption": "none",
        "fallbacks": [{ "dest": 1234, "xver": 0 }]
      },
      "streamSettings": {
        "method": "raw",
        "security": "reality",
        "realitySettings": {
          "target": "www.some-site.com:443",
          "serverNames": ["www.some-site.com"],
          "privateKey": "PrivateKey",
          "shortIds": [""]
        }
      }
    }
  ],
  "outbounds": [{ "protocol": "freedom" }]
}
```

入口 B 是 Nginx，监听回源端口 8443，持真证书：

```nginx
server {
    listen 8443 ssl;
    http2 on;
    server_name cf1.domain.com;
    ssl_certificate     /etc/ssl/fullchain.pem;
    ssl_certificate_key /etc/ssl/privkey.pem;

    location /yourpath {
        proxy_pass http://127.0.0.1:1234;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
}
```

```json title="客户端"
{
  "settings": {
    "address": "你的VPS_IP",
    "port": 443,
    "id": "你的UUID",
    "encryption": "none"
  },
  "streamSettings": {
    "method": "xhttp",
    "security": "reality",
    "realitySettings": {
      "serverName": "www.some-site.com",
      "password": "Password",
      "shortId": "",
      "fingerprint": "chrome"
    },
    "xhttpSettings": {
      "path": "/yourpath",
      "mode": "stream-up",
      "extra": {
        "downloadSettings": {
          "address": "优选 IP",
          "port": 443,
          "method": "xhttp",
          "security": "tls",
          "tlsSettings": {
            "serverName": "cf1.domain.com",
            "alpn": ["h3"],
            "fingerprint": "chrome"
          },
          "xhttpSettings": { "path": "/yourpath" }
        }
      }
    }
  }
}
```

上行直连 443，REALITY 鉴权通过后，首包非法流量回落至 127.0.0.1:1234。下行走 CF 的 QUIC H3，CF 回源到 8443 的 Nginx 反代给同一个 127.0.0.1:1234。

把客户端的上行、下行对调，就是上行过 CDN、下行 REALITY 直连，服务端配置不用改。

### 443 端口复用

443 监听 raw + REALITY 入站，REALITY 鉴权失败的流量回落本机 Nginx，由 Nginx 提供伪装站并将 `/yourpath` 反代到内部 XHTTP 入站；REALITY 鉴权通过但首包非法的流量回落到同一个内部 XHTTP 入站：

```json title="服务端"
{
  "inbounds": [
    // 内部 XHTTP 入站，监听本地
    {
      "listen": "127.0.0.1", // 也可使用 Unix socket
      "port": 1234,
      "protocol": "vless",
      "settings": {
        "users": [{ "id": "XHTTP 的 UUID" }],
        "decryption": "none"
      },
      "streamSettings": {
        "method": "xhttp",
        "xhttpSettings": { "path": "/yourpath" },
        // CF 回源带 CF-Connecting-IP，Nginx 前置注入 X-From-Front
        "sockopt": {
          "trustedXForwardedFor": ["CF-Connecting-IP", "X-From-Front"]
        }
      }
    },
    // raw + REALITY入站，承载 Vision 直连，其余回落
    {
      "listen": "0.0.0.0",
      "port": 443,
      "protocol": "vless",
      "settings": {
        "users": [{ "id": "Vision 的 UUID", "flow": "xtls-rprx-vision" }],
        "decryption": "none",
        "fallbacks": [{ "dest": 1234, "xver": 0 }] // XHTTP 的 H2 preface 非法，回落到 1234
      },
      "streamSettings": {
        "method": "raw",
        "security": "reality",
        "realitySettings": {
          "target": "127.0.0.1:8443",
          "serverNames": ["your.domain.com"],
          "privateKey": "PrivateKey",
          "shortIds": [""]
        }
      }
    }
  ],
  "outbounds": [{ "protocol": "freedom" }]
}
```

XHTTP 的 UUID 只在内部入站校验，几种客户端出站方案共用同一个 `path` 和 UUID。Nginx 配置参考 [Nginx 前置](#nginx-前置tls)，将监听端口改为8443，并给 `your.domain.com` 配置 `server_name` 用于主动探测回落即可。

不能使用 `path` 进行回落，REALITY/TLS 下为 H2，path 提取只解析 H1 的明文请求行，且 XHTTP 会在 path 后追加 UUID 和 seq，H1 下同样无法匹配。

### 元数据搬出 URL

默认情况下会话 ID、seq 拼在 path，padding 置于 `Referer`，位置固定；[请求混淆](#请求混淆) 的参数能把 packet-up 伪装成普通带 cookie 的 GET，请求变成一串没有 body 的 GET：

```json title="客户端/服务端"
"xhttpSettings": {
  "path": "/yourpath",
  "mode": "packet-up",
  "extra": {
    "xPaddingObfsMode": true,
    "xPaddingPlacement": "cookie",
    "xPaddingKey": "_ga",
    "xPaddingMethod": "tokenish",
    "sessionIDPlacement": "cookie",
    "sessionIDKey": "sid",
    "sessionIDTable": "Base62",
    "sessionIDLength": "16-24",
    "seqPlacement": "cookie",
    "seqKey": "n",
    "uplinkDataPlacement": "cookie",
    "uplinkDataKey": "d",
    "uplinkHTTPMethod": "GET"
  }
}
```

`uplinkDataPlacement` 和 `uplinkHTTPMethod` 的 `GET` 仅支持 packet-up 模式，会话 ID 从 UUID 换成 16-24 位的 Base62 串，更像普通 session token。

cookie 每块只装 2 到 3 KB（`uplinkChunkSize` 可调），上行一大就是一长串 cookie，所以只适合上行小或应对 body 检查的场景。

下行 GET 的 `Content-Type: text/event-stream` 可由服务端配置 `noSSEHeader` 去掉；使用 stream-up/one 时，上行的 `application/grpc` 伪装可由客户端配置 `noGRPCHeader` 去掉。

### Browser Dialer

使用真实浏览器的网络栈和 TLS 指纹发起连接，数据经本地 WebSocket 回到 Xray，有一定的性能损耗：

```bash title="客户端"
XRAY_BROWSER_DIALER=127.0.0.1:8080 ./xray -c config.json
```

浏览器打开 `localhost:8080` 并保持。注意：

- `address` 必须是域名，要指定 IP 就改系统 hosts 或内置 DNS
- `tlsSettings` 将失效，HTTP 版本由浏览器决定，`SNI == host == address`
- 浏览器到服务端必须直连

Firefox 93+ 在严格追踪保护 / 隐私窗口下会无视 `unsafe-url` 等宽松 referrer 策略并裁掉跨站请求的 `Referer`([Mozilla 安全博客](https://blog.mozilla.org/security/2021/10/05/firefox-93-features-an-improved-smartblock-and-new-referrer-tracking-protections/))，padding 默认置于 `Referer` 会连不上，把 padding 挪到 header 即可以解决。

### 四层调优（BBR / TFO / MPTCP）

XHTTP 走 H1/H2 时底层是一条 TCP，可在 `sockopt` 里对它做拥塞控制、握手和多路径调优：

```json title="客户端"
"streamSettings": {
  "method": "xhttp",
  "xhttpSettings": { "path": "/yourpath" },
  "sockopt": {
    "tcpFastOpen": true,      // TFO，省一次握手往返
    "tcpCongestion": "bbr",   // 这条连接单独用 BBR
    "tcpMptcp": true          // MPTCP 多路径
  }
}
```

**注意：**

- `tcpCongestion` 使用 `bbr` 前先确认内核支持，`sockopt` 只改这条连接，全局启用需要 `sysctl` 设置 `net.core.default_qdisc=fq` 和 `net.ipv4.tcp_congestion_control=bbr`
- `tcpMptcp` 需要 Linux 5.6+ 且 `net.mptcp.enabled=1`，客户端所在系统也要支持，只开一端等于没开
- `tcpFastOpen` 也可以填队列长度（整数），需客户端、服务端、中间盒都放行，任一环节失败回退普通握手
- 过 CDN 时客户端到 CF 边缘的握手由 CF 决定，`sockopt` 只对 CF 回源段、直连与自建反代链路有意义
- 上下行分离时上行、下行各有各的 `sockopt`；上行设 `"penetrate": true` 可覆盖下行

### FinalMask 给 H3 调拥塞控制

```json title="客户端"
"streamSettings": {
  "method": "xhttp",
  "xhttpSettings": { "path": "/yourpath" },
  "security": "tls",
  // 直连，serverName 用解析到 VPS 的域名（灰云或主域）
  "tlsSettings": { "serverName": "domain.com", "alpn": ["h3"], "fingerprint": "chrome" },
  "finalmask": {
    "quicParams": { "congestion": "force-brutal", "brutalUp": "30 mbps" },
    "udp": [
      // v26.9.9 起端口跳跃是独立的 UDP mask，须在最外层，仅客户端
      { "type": "udphop", "settings": { "remotePorts": "20000-50000", "interval": "5-10", "mode": "intervalRemote" } }
    ]
  }
}
```

XHTTP H3 无协商机制，不支持 `brutal`，只能用免协商的 `force-brutal`，它强制上行按 `brutalUp` 定速发包。两者都只对 H3 直连有意义。

不适用套 CDN 的方案。套 CF 时 `force-brutal` 定速的是客户端到对端的 QUIC，到 CF 边缘终止并以 H2/H1 回源；端口跳跃改的是客户端 QUIC 的目标端口，而 CF 边缘只在标准端口接收 QUIC。

端口跳跃在 v26.9.9 从 `quicParams.udpHop` 挪到了 `finalmask.udp` 下，字段从 `ports` 改为 `remotePorts` 且必须显式指定 `mode`：

- `intervalRemote`：周期换远端端口，底层 socket 和本地源端口不动，最经典的端口跳跃
- `intervalLocal`：周期换本地源端口，跳跃点新开本地 UDP socket
- `perConnRemote`：每条连接定一次，之后整条连接固定不变

老写法在新版会被静默丢弃；服务端要让被跳到的整段端口都能到达 QUIC 监听端口，一般在 nftables/iptables 对端口段进行重定向。

H3 直连默认带着 quic-go 的 Chrome QUIC 指纹（零长 Connection ID），要关掉可在 `quicParams` 里设 `disableChromeParrot`。官方文档不建议服务端裸跑 quic-go H3，更推荐藏在真 Nginx/Caddy 后面。

## CDN 相关

### Cloudflare

橙云子域：CF 代理流量，可做 CDN 优选、域前置、回源目标。

灰云子域：CF 只做 DNS 解析、不代理，只有灰云才能解析出真实 IP，适合给直连节点当 `address`。

当面板 SSL 模式为 Flexible 时，CF 回源走明文 HTTP，建议使用 Full (strict) 并配证书。

回源端口需要是 [Cloudflare 支持的端口](https://developers.cloudflare.com/fundamentals/reference/network-ports/)，非标端口（比如 10086）需使用 Origin Rule 重写回源端口。

CF 面板可选设置 Cache Rules，按 CDN 主机名或 XHTTP path 匹配、缓存资格设为绕过（Bypass），虽然 XHTTP 下行本来就不进缓存，但可以预防 CF 版本行为变化。

### VLESS Encryption

过 CDN 时外层 TLS 终结在 CF 边缘，CF 解密后能看到内层 VLESS 明文。纯 VLESS 自身不加密，能读到明文的包括 CF 本身，以及回源段若非 Full (strict) 时 CF 与 VPS 之间的中间人。

`VLESS Encryption` 在 VLESS 内层端到端认证加密，独立于外层 TLS 与公共 CA 体系，客户端预置服务端静态公钥（X25519 或 ML-KEM-768），每条连接做临时密钥交换，兼具前向安全与后量子安全；载荷走 AES-256-GCM / ChaCha20-Poly1305，即使 CF 或链路上任何人拿着有效证书 MITM 掉外层 TLS，没有服务端静态私钥也无法伪造内层握手和读取内容。

执行 `xray vlessenc` 生成配对的 `decryption`/`encryption`，输出含 X25519 与 ML-KEM-768 两版，二选一不要混用（握手本身两者都后量子安全，ML-KEM-768 版额外能防客户端参数泄露后被未来量子计算机破解出私钥冒充服务端）

配置串以 `.` 分块:

```json
"mlkem768x25519plus.<mode>.<rtt>.<...>.(padding len).(padding gap)...(X25519 PrivateKey).(ML-KEM-768 Seed)..."
```

`mlkem768x25519plus` 为握手方式，`<mode>` 为流量外观：

- `native`：头部有公钥特征，流量为 TLSv1.3 的 `23 3 3 l>>8 l` AEAD 头特征
- `xorpub`：头部无公钥特征，流量同上
- `random`：全随机数加密

`<rtt>` 服务端为 0-RTT 有效期如 `600s`（可写范围 `60-600s`，`0` 则关闭 0-RTT），客户端为 `0rtt`/`1rtt`。

Padding 是可选的参数，仅作用于 1-RTT 以消除握手的长度特征，双端默认值均为 "100-111-1111.75-0-111.50-0-3333"：

1. 在 1-RTT client/server hello 后以 100% 的概率粘上随机 111 到 1111 字节的 padding
2. 以 75% 的概率等待随机 0 到 111 毫秒（"probability-from-to"）
3. 再次以 50% 的概率发送随机 0 到 3333 字节的 padding（若为 0 则不 Write()）

服务端、客户端可以设置不同的 padding 参数，按 len、gap 的顺序无限串联，第一个 padding 需概率 100%、至少 35 字节

```go title="common.go"
paddingLens = [][3]int{{100, 111, 1111}, {50, 0, 3333}}
paddingGaps = [][3]int{{75, 0, 111}}
```

配置模板：

```json title="服务端"
"settings": {
  "users": [{ "id": "你的UUID" }],
  "decryption": "mlkem768x25519plus.native.600s.私钥"
}
```

```json title="客户端"
"settings": {
  "address": "优选 IP",
  "port": 443,
  "id": "你的UUID",
  "encryption": "mlkem768x25519plus.native.0rtt.公钥"
}
```

**注意：**

- 下文的 [ECH](#ech-加密) 加密的是 SNI，属于防探测/隐私手段，不防 MITM
- REALITY 本身已在同一条直连链路上做了服务端认证与端到端加密，无需另外设置
- 裸跑（`security: "none"`） 抗不住熵检测与主动探测，不要这样做
- 只要 TLS 终结在你不完全信任的中间盒，VLESS Encryption 就有意义

### ECH 加密

域名开启 ECH 后，客户端设置 `tlsSettings.echConfigList` 即可加密 SNI。格式为 `"域名+DNS服务器"`，服务器支持 `https://`（DoH）、`h2c://`、`udp://` 三种：

```json title="客户端"
"tlsSettings": {
  "serverName": "cf1.domain.com",
  "alpn": ["h2"],
  "echConfigList": "cf1.domain.com+udp://1.1.1.1:53"
}
```

不写域前缀时按 `serverName` 查询，写成 `域名+DNS服务器` 则强制查该域名的 HTTPS(TYPE65) 记录取 ECHConfig。查询本身对该 DNS 服务器是可见的，彻底隐藏需使用 base64 的 ECHConfigList。

## 证书：ACME DNS-01 与 CF Origin CA

cf1/cf2 同属一个 zone，签一张 `*.domain.com`（可加主域）的通配符即可：

|          | ACME + DNS-01          | Origin CA            |
| -------- | ---------------------- | -------------------- |
| 签发     | 需 API token           | 面板点几下，复制粘贴 |
| 有效期   | 90 天，cron 自动续     | 15 年，无续期        |
| 谁信任   | 所有浏览器/系统        | 只有 CF              |
| 额外依赖 | acme.sh + token 存 VPS | 无                   |

### ACME DNS-01 证书

登录 Cloudflare 获取 Cloudflare API Token

验证 token 是否存活：

```shell
curl -s -H "Authorization: Bearer 你的token" https://api.cloudflare.com/client/v4/user/tokens/verify
```

签发证书：

```shell
export CF_Token="你的token"
export CF_Account_ID="你的AccountID"

acme.sh --set-default-ca --server letsencrypt
acme.sh --issue --dns dns_cf -d "domain.com" -d "*.domain.com" --keylength ec-256
```

token 会被明文存进 `~/.acme.sh/account.conf` 供续期自动复用，机器需保证安全，如发生泄露需要在面板 Revoke。

安装给 Xray：

```shell
mkdir ~/xray_cert
acme.sh --install-cert -d "domain.com" --ecc \
    --fullchain-file ~/xray_cert/xray.crt \
    --key-file ~/xray_cert/xray.key
chmod +r ~/xray_cert/xray.key   # Xray 非 root 运行时
```

acme.sh 自带每日 cron，自动续期并重新执行 install-cert，Xray 默认热重载证书。

### CF Origin CA 证书

只有 CF 信任，15 年免续：

1. 面板 -> SSL/TLS -> Origin Server -> Create Certificate
2. 保持默认：ECC 私钥，Hostnames 填 `domain.com` 和 `*.domain.com`，15 年有效期 -> Create
3. 页面给出 Origin Certificate 和 Private Key 两段 PEM，存成两个文件：

```shell
mkdir ~/xray_cert
vim ~/xray_cert/xray.crt   # 粘贴 Origin Certificate 整段，含 BEGIN/END 行
vim ~/xray_cert/xray.key   # 粘贴 Private Key 整段
chmod 600 ~/xray_cert/xray.key
chmod +r ~/xray_cert/xray.crt
```

4. Xray/Nginx 的引用方式与 ACME 完全一致，泄露或换机器时在 Origin Server 页面 Revoke。

## 注意事项

- packet-up 和 `Referer` 长 padding 会刷出大量长日志，建议在反代软件里指定不记录；使用请求混淆也可让日志形态不再扎眼
- `address` 填优选 IP 时 `serverName` 必填，且 IP 不能当 SNI
- v26.7.11 起 REALITY 服务端在 `minClientVer` 留空时默认为 26.3.27，其他内核和旧客户端会被静默拒连，不建议降低 `minClientVer` 放行，也不要让客户端发出非正常的 ClientHello
- v26.9.8 起 REALITY 服务端移除 `minClientVer` 限制并强制要求 ClientHello 携带 X25519MLKEM768，奇怪和过时的指纹会直接被当回落流量处理
- XHTTP 目前只有 Xray 原生支持；sing-box 主线尚未内置，有社区 fork 支持；Mihomo 自 2026 年 3 月（约 v1.19.22）起支持 `xhttp-opts`。一些订阅转换工具会把 XHTTP 的某些字段静默丢弃，实践中需留意
