---
title: XHTTP 原理、玩法与实战配置
published: 2026-08-03
description: 对 XHTTP 官方文档的研读与实践：三种模式与 XMUX 的取舍、过 CF 与 Nginx 前置的配置，以及上下行分离、REALITY 混搭等进阶玩法。
image: ""
tags: [VPS, Xray, XHTTP, REALITY, Cloudflare]
category: 网络
draft: false
---

## 前言

本文来自对 [XHTTP: Beyond REALITY](https://github.com/XTLS/Xray-core/discussions/4113) 与 [官方文档](https://xtls.github.io/config/) 的研读和实践，以源码为准，文档过时处已逐一更正并标注。

配置基于 Xray v26.9.8 的字段名，示例统一使用以下占位：`domain.com` 为主域名，`cf1.domain.com` / `cf2.domain.com` / `cf3.domain.com` 为开启橙云的子域，`/yourpath` 为 XHTTP path，`vpsadmin` 账户运行 Xray，证书目录 `~/xray_cert`。

## 优势

- XMUX：H2/H3 的 0-RTT 多路复用控制
- 上下行分离：服务端仅按 path 中随机生成的 UUID 关联上下行，两个方向可以走完全不同的入口
- 请求元数据混淆：会话 ID、seq、上行数据的载体（path / query / header / cookie）与形态都可配置、随机化，避免在 CDN 里留下固定模式
- `extra` 分享机制：`host`、`path`、`mode` 以外的所有参数可整块塞进分享链接，由服务发布者下发
- Browser Dialer：用真浏览器的网络栈和 TLS 指纹发请求
- 无需 gRPC 库，性能更好，下行是独立 GET 不受 CDN 对 gRPC 的限速，相比 WS/HTTPUpgrade，没有 `ALPN = http/1.1` 的特征

## 模式

| 模式       | 上行                           | 下行     | HTTP 请求数 | 说明                         |
| ---------- | ------------------------------ | -------- | ----------- | ---------------------------- |
| packet-up  | 分包 `POST /path/UUID/seq`     | GET 流式 | N 个        | 兼容性最强                   |
| stream-up  | 流式 `POST /path/UUID`         | GET 流式 | 2 个        | 上行不牺牲效率，上下行可分离 |
| stream-one | 单个 `POST /path/`，响应即下行 | 同一请求 | 1 个        | 最接近普通请求，REALITY 默认 |

**"mode" 四选一，客户端、服务端默认值都是 "auto"：**

- "auto" - 客户端：一律 packet-up，**REALITY 时 stream-one**（有 `downloadSettings` 时 stream-up）/ 服务端：同时接受三种模式
- "packet-up" - 客户端：分包上行 + 流式下行（单独的子连接）/ 服务端：仅接受 packet-up
- "stream-up" - 客户端：流式上行 + 流式下行（另一条子连接）/ 服务端：仅接受 stream-up 和 stream-one
- "stream-one" - 客户端：流式上行 + 流式下行（同一条子连接），不能有 downloadSettings / 服务端：仅接受 stream-one

**模式细节**：

- packet-up 的 seq 从 0 开始，必须发完上一个 POST 的 body 再发下一个；乱序到达由服务端按 seq 重组，默认最多缓存 30 个，超限断连。会话 ID 与 seq 默认拼在 path（`/yourpath/UUID/seq`），开启混淆后也可挪到 query、header 或 cookie
- stream-up / stream-one 的上行默认带 `Content-Type: application/grpc` 伪装（`noGRPCHeader` 可关），加上这个 header 后 H2 流式上行可穿透 CF，需面板开 gRPC 支持
- stream-one 的 path 若末尾无 `/` 会自动补上
- 下行响应头与 packet-up 一致；stream-one 会出现以 SSE 回应 gRPC 的组合，遇到问题试 `noSSEHeader`

**packet-up 专属参数**：

- `scMaxEachPostBytes`：每个 POST 最多携带的字节数，默认 1000000（1MB），应小于中间盒允许的最大值，服务端会拒绝超限 POST
- `scMinPostsIntervalMs`：仅客户端，单个代理请求内 POST 的最小间隔，默认 30ms
- `scMaxBufferedPosts`：仅服务端，最多缓存的 POST 数，默认 30

前两个建议填范围字符串（如 `"500000-1000000"`）每次随机，减少指纹。三者均基于单个代理请求独立计数。

**stream-up 专属参数**：

- `scStreamUpServerSecs`：仅服务端，默认 `"20-80"` 随机，每隔该时长向 stream-up 上行 POST 的响应方向写 `xPaddingBytes` 个字节保活（前提是请求带了 padding，默认总是带），设 `-1` 停发保活数据

## XMUX

H2/H3 均为 0-RTT 多路复用，XMUX 是控制它们的核心接口：

| 参数               | 含义                                                                | 全 0 时的默认值    |
| ------------------ | ------------------------------------------------------------------- | ------------------ |
| `maxConcurrency`   | 每条连接最多同时承载的代理请求数，达到后建新连接                    | 0（不限）          |
| `maxConnections`   | 最多连接数，达到前每个新请求开新连接，之后开始复用                  | 3（固定）          |
| `cMaxReuseTimes`   | 一条连接最多被复用几次                                              | 0（不限）          |
| `hMaxRequestTimes` | 一条连接累计承载的 HTTP 请求上限（对付 Nginx 每连接 1000 请求上限） | `"600-900"` 随机   |
| `hMaxReusableSecs` | 一条连接的最长复用时长（对付 Nginx 一小时上限）                     | `"1800-3000"` 随机 |
| `hKeepAlivePeriod` | 空闲时 H2/H3 保活间隔（秒），0 为 Chrome H2 45s / quic-go 10s       | 0                  |

多线程测速前可设 `"maxConcurrency": 1`，只用一条底层连接复用到底可以设 `"maxConnections": 1`，日常可保持全 0。

**用法上的注意：**

- `maxConcurrency` 与 `maxConnections` 冲突（都大于 0 直接报错），只能二选一
- `hKeepAlivePeriod` 是唯一不允许填范围的项（该值取随机本身才是特征），且允许负数（-1 关闭空闲保活）
- 填了任意一项后其余项就没有默认值了，须全部显式填写
- packet-up 循环 POST 超过 `hMaxRequestTimes` / `hMaxReusableSecs` 时会自动切换到另一条连接，占一次 reuseTimes 但不占 concurrency
- 使用 XHTTP 时不要启用 mux.cool，新版服务端已检查，只接受纯 XUDP

## 请求混淆

padding 默认放在 `Referer: /yourpath?x_padding=XXXX...`，这些在 CDN、反代的访问日志与 WAF 规则里都是显眼的模式，后续版本加入了混淆参数，把元数据挪走并随机化

| 参数                                 | 作用                                                                     | 默认值                                  |
| ------------------------------------ | ------------------------------------------------------------------------ | --------------------------------------- |
| `xPaddingObfsMode`                   | 总开关，开启后 padding 的位置与样式按下列参数走                          | `false`（固定 `Referer` + `x_padding`） |
| `xPaddingPlacement`                  | padding 放哪：`queryInHeader` / `cookie` / `header` / `query`            | `queryInHeader`                         |
| `xPaddingMethod`                     | padding 内容：`repeat-x`（重复 `X`）/ `tokenish`（随机 Base62）          | `repeat-x`                              |
| `xPaddingKey` / `xPaddingHeader`     | query / cookie 的键名 / 承载 query 的头名（例如 `Referer`、`Origin` 等） | `x_padding` / `X-Padding`               |
| `sessionIDPlacement`                 | 会话 ID 放哪：`path` / `query` / `header` / `cookie`                     | `path`                                  |
| `sessionIDTable` / `sessionIDLength` | 会话 ID 的字符表（预置 `Base62`、`Alphabet`、`hex` 等）与长度范围        | 空（用 UUID）                           |
| `seqPlacement`                       | seq 放哪（同上四选一）                                                   | `path`                                  |
| `uplinkDataPlacement`                | packet-up 上行数据放 `body` / `header` / `cookie`（后两者仅 packet-up）  | `body`                                  |
| `uplinkHTTPMethod`                   | 上行 HTTP 方法，`GET` 仅 packet-up 可用                                  | `POST`                                  |
| `serverMaxHeaderBytes`               | 服务端接受的最大请求头字节数（数据放 header 时要相应调大）               | 8192                                    |

客户端模板（可整块放进 `extra` 下发；服务端配同样的值）：

```json title="客户端"
"xhttpSettings": {
  "path": "/yourpath",
  "extra": {
    "xPaddingObfsMode": true,
    "xPaddingPlacement": "queryInHeader",
    "xPaddingMethod": "tokenish",
    "xPaddingKey": "x",
    "xPaddingHeader": "Origin",
    "sessionIDPlacement": "path",
    "sessionIDTable": "Base62",
    "sessionIDLength": "12-20"
  }
}
```

注意：

- `xPaddingBytes` 本身不可关闭（填 0 或负数会报错），默认 100-1000 随机
- `tokenish` 生成随机 Base62 串，按 HPACK huffman 编码后长度落在 `xPaddingBytes` 区间内，服务端校验同样按 huffman 长度算，比一串 `X` 更像真实数据
- `queryInHeader` 仍是把 padding 塞进某个头（可自定义，默认 `Referer`）的 URL query 里，对 CF 兼容性最好；`cookie` / `header` / `query` 则完全离开 URL
- 会话 ID 不再是 UUID，而是从字符表随机取的串（如 `/yourpath/aB3xK9mPqZ2r`），`sessionIDTable` × `sessionIDLength` 的组合空间须大于 2^31，否则报错
- 服务端校验 padding 的存在与长度：两端参数不一致时请求会被 400 拒绝，调参要同步改

## XHTTP + REALITY 对比 RAW + REALITY + Vision

REALITY 时客户端固定使用 H2，XTLS/Vision 只在 TCP+TLS/REALITY 下可用。

|                  | RAW + REALITY + Vision            | XHTTP + REALITY                       |
| ---------------- | --------------------------------- | ------------------------------------- |
| 新连接延迟       | 每条代理连接一次 TCP+TLS 握手     | XMUX 复用，新请求 0-RTT，延迟更低     |
| 多线程测速       | 更强，每条连接独立拥塞窗口        | 不如 Vision，除非 `maxConcurrency: 1` |
| CPU / 吞吐       | Linux 下自动 Splice，内核直接转发 | 无 Splice，H2 帧处理走用户态          |
| 上下行分离       | 没有                              | 有（需 packet-up/stream-up）          |
| 中间盒/CDN       | 不可能                            | 本身为此设计                          |
| 抗单连接时序分析 | Vision 内层握手随机填充           | padding + XMUX 随机化 + 多流混合      |

纯直连、要单流拉满带宽、服务器 CPU 不富裕、跑 Linux，适合 RAW。

网页浏览（大量小连接，0-RTT 收益直接）、要上下行分离、要过 CDN 或前置反代，适合 XHTTP。

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
          "privateKey": "xray x25519 的 PrivateKey",
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

前提：cf1.domain.com 开橙云、CF 面板 SSL 模式为 Full (strict)，服务端持证书。

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

H3 版只改一处 `alpn`：

```json title="客户端"
"tlsSettings": { "serverName": "cf1.domain.com", "alpn": ["h3"], "fingerprint": "chrome" }
```

H2 且要流式上行时显式指定 `mode`（需 CF 面板开 gRPC 支持）：

```json title="客户端"
"xhttpSettings": {
  "path": "/yourpath",
  "mode": "stream-up"
}
```

若 CDN 对请求体大小敏感，可调分包节奏：

```json title="客户端"
"xhttpSettings": {
  "path": "/yourpath",
  "extra": {
    "scMaxEachPostBytes": "500000-1000000",   // 要小于 CDN 允许的最大请求体
    "scMinPostsIntervalMs": "10-50"
  }
}
```

客户端连 CF 边缘 IP，SNI 为 cf1，CF 用边缘证书握手，按 Host 回源到 VPS 的端口，验证 Origin 证书后转发给 Xray。H3 版客户端跑 quic-go QUIC，到 CF 被降成 H1/H2 回源，服务端无需监听 UDP。

CF 会掐断下行 100 秒无实际数据的 HTTP，代理长连接需应用层保活，比如 sshd 的 `ClientAliveInterval`。

### Nginx 前置（TLS）

Nginx 拿走 443（持真证书），XHTTP 入站退到本地明文：

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

TLS 在 Nginx 终结，按 path 把 `/yourpath` 以 h2c 转给本地 1234，其余路径当普通网站服务。主动探测看到真网站，TLS 指纹是 Nginx 的而非 Go 的。

packet-up 模式下 `grpc_pass` 不适用，改普通反代并关缓冲：

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

客户端不出现新块，沿用 [上文](#过-CDNTLS) 的字段。

### 上下行分离

关于 `downloadSettings`：

- 是一套完整的 `streamSettings` 外加 `address`/`port`，`method` 必须为 `"xhttp"`（不可省略），`security` 可为 `"tls"` 或 `"reality"`
- 下行配置不继承上行的任何配置；连 XMUX 默认值 roll 出的具体数都是各自独立随机的，随时间推移上下行复用完全不对称
- `sockopt` 项也可被分享，但上行 `sockopt` 设 `"penetrate": true` 可覆盖下行，适合打 `mark` 的情况

#### 同一 CDN：上行 IPv4 H2，下行 IPv6 H3

只改客户端：

```json title="客户端"
"streamSettings": {
  "method": "xhttp",
  "security": "tls",
  "tlsSettings": { "serverName": "cf1.domain.com", "fingerprint": "chrome" },
  "xhttpSettings": {
    "path": "/yourpath",
    "mode": "stream-up",          // 必须：stream-one 只有一个请求，分不开
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

客户端随机生成 UUID，上行 `POST /yourpath/UUID` 走 IPv4 的 TCP+TLS+H2 到边缘 IP-A，下行 `GET /yourpath/UUID` 走 IPv6 的 QUIC H3 到边缘 IP-B。两个方向的源 IP、目标 IP、四层协议、HTTP 版本全不同。服务端按 path 中的 UUID 把两半缝合，30 秒内没缝上就终止会话，基于单条连接的检测只能看到半条流。

#### 同域域前置

先分清三个地址字段，一次 XHTTP over CDN 的请求里它们互相独立：

| 字段                     | 是什么                                | 谁看得见                    | 决定什么                        |
| ------------------------ | ------------------------------------- | --------------------------- | ------------------------------- |
| `address`                | 实际拨号目标                          | 链路上所有人                | 包发到哪个 IP（优选 IP 填这里） |
| `tlsSettings.serverName` | TLS ClientHello 的 SNI                | 明文，GFW 和 CDN 都看得见   | CDN 用哪张证书握手              |
| `xhttpSettings.host`     | HTTP Host 头（H2/H3 为 `:authority`） | TLS 加密内，只有 CDN 看得见 | CDN 回源到哪台机器              |

SNI 与 Host 不一致即域前置；两者是同一 zone 内不同子域即同域域前置。跨 zone 的域前置 CF 已封，同 zone 内没有问题。

以 cf1 为上行门面、cf2 为下行门面、cf3 为共同 Host，三个均橙云、指向同一 VPS：

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

两条 TLS 握手 SNI 分别是 cf1 和 cf2，两个方向的 Host 都是 cf3，CF 按 cf3 回源到你的 VPS。

当 cf1 和 cf2 都橙云直指同一台 VPS 时，不填 `host` 也可以，各方向 Host 跟着自己的 SNI 走，CF 回源到同一台机器同一 path，照样按 UUID 缝合。需要 `host` 的场景：源站前有 Nginx 按 `server_name` 分流、只想为一个域名配回源规则（Origin Rules / Page Rules）、或想让两个方向走完全一样的回源逻辑。

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

#### 上行 REALITY 直连 + 下行过 CDN

最接近"REALITY 套 CDN"的做法。上下行必须落到同一个 XHTTP 入站，而一个入站只能有一种 `security`，所以 REALITY 和 TLS 的终结都挪到 XHTTP 入站前面。

服务端，两个入口一个入站：

```json title="服务端"
{
  "inbounds": [
    // 唯一的 XHTTP 入站，明文，只听本地
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
    // 入口 A：REALITY 前门，占 443，非法 VLESS 首包回落到 1234
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

入口 B 是 Nginx，监听 CF 允许的回源端口 8443，持真证书，服务下行 GET：

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

客户端：

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

上行 `POST /yourpath/UUID` 直连 VPS 443，先过 REALITY 鉴权，解密后首包是 H2 preface 而非合法 VLESS，回落至 127.0.0.1:1234。下行 `GET /yourpath/UUID` 走 CF 的 QUIC H3，CF 回源到 8443 的 Nginx 再转给同一个 127.0.0.1:1234，两方按 UUID 汇合。

### Browser Dialer

```bash title="客户端"
XRAY_BROWSER_DIALER=127.0.0.1:8080 ./xray -c config.json
```

浏览器打开 `localhost:8080` 并保持。注意：

- `address` 必须是域名，要指定 IP 就改系统 hosts 或内置 DNS
- `tlsSettings` 将失效，HTTP 版本由浏览器决定，`SNI == host == address`
- 非 80/443 的端口已支持（2026-04 起，端口会自动拼进交给浏览器的 URL）
- 浏览器到服务端必须直连

Xray 把 "连接 `https://cf1.domain.com/yourpath`" 的动作交给页面里的 JS，浏览器用自己真实的网络栈和 TLS 指纹发出，数据经本地 WebSocket 回到 Xray，指纹是真的，但有一定的性能损耗。

### FinalMask 给 H3 调拥塞控制

```json title="客户端"
"streamSettings": {
  "method": "xhttp",
  "xhttpSettings": { "path": "/yourpath" },
  "security": "tls",
  "tlsSettings": { "serverName": "cf1.domain.com", "alpn": ["h3"], "fingerprint": "chrome" },
  "finalmask": {
    "quicParams": {
      "congestion": "force-brutal",
      "brutalUp": "30 mbps",
      "udpHop": { "ports": "20000-50000", "interval": "5-10" }
    }
  }
}
```

XHTTP H3 无协商机制，用不了 `brutal`，只能用免协商的 `force-brutal`，它强制上行按 `brutalUp` 定速发包，只对 H3 直连有意义。官方文档不建议服务端裸跑 quic-go H3，更推荐藏在真 Nginx/Caddy 后面。

## 域名与 Cloudflare

橙云子域：CF 代理流量，可做 CDN 优选、域前置、回源目标。

灰云子域：CF 只做 DNS 解析、不代理。适合给直连节点当 `address`，只有灰云才解析出 VPS 真实 IP。

当面板 SSL 模式为 Flexible 时，CF 回源走明文 HTTP，建议使用 Full (strict) 并配证书。

回源端口需要是 [Cloudflare 支持的端口](https://developers.cloudflare.com/fundamentals/reference/network-ports/)，非标端口（比如 10086）需使用 Origin Rule 重写回源端口。

CF 面板可以再加一条 Cache Rules，按 CDN 主机名或 XHTTP path 匹配、缓存资格设为绕过（Bypass），虽然 XHTTP 下行本来就不进缓存，但可以预防 CF 版本行为变化。

### ECH：加密 SNI（可选）

CF 面板开启 ECH 后，客户端在 `tlsSettings` 加 `echConfigList` 即可加密 SNI。格式为 `"域名+DNS服务器"`，服务器支持 `https://`（DoH）、`h2c://`、`udp://` 三种：

```json title="客户端"
"tlsSettings": {
  "serverName": "cf1.domain.com",
  "alpn": ["h3", "h2"],
  "echConfigList": "cf1.domain.com+udp://223.5.5.5:53"
}
```

域前缀强制使用该域名的 ECHConfig，不向 DNS 服务器暴露在查谁的 HTTPS 记录。

### 证书：ACME DNS-01 与 CF Origin CA

cf1/cf2 同属一个 zone，签一张 `*.domain.com`（可加主域）的通配符即可，Nginx 的 `server_name` 分流也能各自匹配上。

|          | ACME + DNS-01          | Origin CA            |
| -------- | ---------------------- | -------------------- |
| 签发     | 需 API token           | 面板点几下，复制粘贴 |
| 有效期   | 90 天，cron 自动续     | 15 年，无续期        |
| 谁信任   | 所有浏览器/系统        | 只有 CF              |
| 额外依赖 | acme.sh + token 存 VPS | 无                   |

#### ACME DNS-01 证书

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

acme.sh 装好时自带每日 cron，到期前 30 天自动续并重新执行 install-cert；Xray 默认热重载证书。

#### CF Origin CA 证书

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

- packet-up 和 `Referer` 长 padding 会刷出大量长日志，建议在反代软件里指定不记录；开启请求混淆后也可以让日志形态不再扎眼
- `address` 填优选 IP 时 `serverName` 必填，且 IP 不能当 SNI，留空则无 SNI 扩展，CF 会拒
- v26.9.8 起 REALITY 服务端强制 ClientHello 携带 X25519MLKEM768，奇怪和过时指纹会直接被当回落流量处理
