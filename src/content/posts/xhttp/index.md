---
title: XHTTP 原理、玩法与实战配置
published: 2026-08-03
description: 对 XHTTP 官方文档的研读与实践：三种模式与 XMUX 的取舍、过 CF 与 Nginx 前置的配置，以及上下行分离、REALITY 混搭等进阶玩法。
image: ''
tags: [VPS, Xray, XHTTP, REALITY, Cloudflare]
category: 网络
draft: false
---

## 前言

本文来自对 [XHTTP: Beyond REALITY](https://github.com/XTLS/Xray-core/discussions/4113) 与 [官方文档](https://xtls.github.io/config/) 的研读和实践。

配置基于 Xray v26.7.11 的字段名：传输方式写在 `streamSettings.method`（旧版为 `streamSettings.network`）。

示例统一使用以下占位：`domain.com` 为主域名，`cf1.domain.com` / `cf2.domain.com` / `cf3.domain.com` 为开启橙云的子域，`/yourpath` 为 XHTTP path，VPS 上以 `vpsadmin` 账户运行 Xray，证书目录 `~/xray_cert`。

## 分包上行、流式下行

CDN 和大多数 HTTP 中间盒为保护源站，除了有特殊支持的 WS、gRPC 外，一般会缓存完整个请求再回源。Tor 的 Meek 协议把往返流量都包装成 HTTP 请求来穿透这类中间盒，代价是速率极低。

XHTTP 只把上行包装为一个个 POST 请求，下行用一个长期的 GET 流式返回。下行响应头带 `X-Accel-Buffering: no`（禁用中间盒缓冲）、`Cache-Control: no-store`（无需缓存）、`Content-Type: text/event-stream`（伪装成 SSE）。从网站下载大文件时 CDN 回源不会等源站发完整个文件，而是来多少转发多少，XHTTP 的流式下行建立在这个行为上，所以最重要的下行速率可以拉满。上行本来打折，后来加了 stream-up 流式上行补齐，几轮优化后 packet-up 的速率也直追 stream-up。

## 优势

- QUIC H3 过 CDN：中间盒做 HTTP 版本转换（H3 进、H1/H2 回源），服务端只需监听 TCP 上的 H1/H2，客户端 `alpn` 填 `"h3"` 即可用 QUIC
- XMUX：H2/H3 的 0-RTT 多路复用控制
- 上下行分离：服务端仅按 path 中随机生成的 UUID 关联上下行，两个方向可以走完全不同的入口
- Header padding（`xPaddingBytes`，默认 100-1000 随机）：请求头的 padding 放在 `Referer: ...?x_padding=XXX...`，响应头用 `X-Padding`，消除固定长度特征
- `extra` 分享机制：`host`、`path`、`mode` 以外的所有参数可整块塞进分享链接，由服务发布者下发
- Browser Dialer：用真浏览器的网络栈和 TLS 指纹发请求
- 相比 gRPC 传输层：无需 gRPC 库性能更好，下行是独立 GET 不受 CDN 对 gRPC 的限速
- 相比 WS/HTTPUpgrade：没有 `ALPN = http/1.1` 的显著特征
- 服务端可藏在真正的 Nginx/Caddy 后面，指纹特征比裸跑 quic-go 少得多

## 三种模式

| 模式 | 上行 | 下行 | HTTP 请求数 | 说明 |
|---|---|---|---|---|
| packet-up | 分包 POST `/path/UUID/seq` | GET 流式 | N 个 | 兼容性最强，H3 的默认模式 |
| stream-up | 流式 POST `/path/UUID` | GET 流式 | 2 个 | 上行不牺牲效率，上下行可分离 |
| stream-one | 单个 POST `/path/`，响应即下行 | 同一请求 | 1 个 | 最接近普通请求形状，REALITY 直连默认 |

**"mode" 四选一，客户端、服务端默认值都是 "auto"：**
- "auto" - 客户端：TLS H2 时 stream-up，**REALITY 时 stream-one**（有 `downloadSettings` 时 stream-up），否则 packet-up / 服务端：同时接受三种模式
- "packet-up" - 客户端：分包上行 + 流式下行（单独的子连接）/ 服务端：仅接受 packet-up
- "stream-up" - 客户端：流式上行 + 流式下行（另一条子连接）/ 服务端：仅接受 stream-up 和 stream-one
- "stream-one" - 客户端：流式上行 + 流式下行（同一条子连接），不能有 downloadSettings / 服务端：仅接受 stream-one

**模式细节**：

- packet-up 的 seq 从 0 开始，必须发完上一个 POST 的 body 再发下一个；乱序到达由服务端按 seq 重组，默认最多缓存 30 个，超限断连。UUID 和 seq 设计在 path 而非 query string，以避免奇怪的问题
- stream-up / stream-one 的上行默认带 `Content-Type: application/grpc` 伪装（`noGRPCHeader` 可关），加上这个 header 后 H2 流式上行可穿透 CF，需面板开 gRPC 支持
- stream-one 的 path 若末尾无 `/` 会自动补上
- 下行响应头与 packet-up 一致；stream-one 会出现以 SSE 回应 gRPC 的组合，遇到问题试 `noSSEHeader`

**packet-up 专属参数**：

- `scMaxEachPostBytes`：每个 POST 最多携带的字节数，默认 1000000（1MB），应小于中间盒允许的最大值，服务端会拒绝超限 POST
- `scMinPostsIntervalMs`：仅客户端，单个代理请求内 POST 的最小间隔，默认 30ms
- `scMaxBufferedPosts`：仅服务端，最多缓存的 POST 数，默认 30

前两个建议填范围字符串（如 `"500000-1000000"`）每次随机，减少指纹。三者均基于单个代理请求独立计数，即 sc = sub-connection。

**stream-up 专属参数**：

- `scStreamUpServerSecs`：仅服务端，默认 `"20-80"` 随机，每隔该时长发 `xPaddingBytes` 个字节保活。存在原因是 CF 会掐断下行 100 秒无实际数据的 HTTP，而 stream-up 的上行 POST 的响应方向会被这个机制掐断。设 `-1` 关闭并退回旧行为

模式选择：REALITY 直连保持默认，要上下行分离才切 stream-up；TLS 过 CF/Nginx 用 stream-up（CF 开 gRPC，Nginx 用 `grpc_pass`）；走 H3 或 stream-up 穿不过去的中间盒退到 packet-up。服务端留 `auto` 三种全收，只在客户端调模式。

## XMUX

H2/H3 均为 0-RTT 多路复用，XMUX 是控制它们的核心接口：

| 参数 | 含义 | 全 0 时的默认值 |
|---|---|---|
| `maxConcurrency` | 每条连接最多同时承载的代理请求数，达到后建新连接 | `"16-32"` 随机 |
| `maxConnections` | 最多连接数，达到前每个新请求开新连接，之后开始复用 | 0（不限） |
| `cMaxReuseTimes` | 一条连接最多被复用几次 | 0（不限） |
| `hMaxRequestTimes` | 一条连接累计承载的 HTTP 请求上限（对付 Nginx 每连接 1000 请求上限） | `"600-900"` 随机 |
| `hMaxReusableSecs` | 一条连接的最长复用时长（对付 Nginx 一小时上限） | `"1800-3000"` 随机 |
| `hKeepAlivePeriod` | 空闲时 H2/H3 保活间隔（秒），0 为 Chrome H2 45s / quic-go 10s | 0 |

**用法上的注意：**

- `maxConcurrency` 与 `maxConnections` 冲突，只能二选一
- `hKeepAlivePeriod` 是唯一不允许填范围的项（该值取随机本身才是特征），且允许负数（-1 关闭空闲保活）
- 填了任意一项后其余项就没有默认值了，须全部显式填写
- packet-up 循环 POST 超过 `hMaxRequestTimes` / `hMaxReusableSecs` 时会自动切换到另一条连接，占一次 reuseTimes 但不占 concurrency
- 默认值全部取随机的目的在于消除连接数层面的 fixed pattern，这也是 `maxConcurrency` 选范围形式而非固定值的原因
- 使用 XHTTP 时不要启用 mux.cool，新版服务端已检查，只接受纯 XUDP

常用组合：多线程测速前设 `"maxConcurrency": 1`，否则数字难看；要一条连接复用到底设 `"maxConnections": 1`。

## XHTTP + REALITY 对比 RAW + REALITY + Vision

XHTTP + REALITY 只支持 H1/H2。REALITY 是对 TLS 的修改，只支持 RAW/XHTTP/gRPC 三种传输。

| | RAW + REALITY + Vision | XHTTP + REALITY |
|---|---|---|
| 新连接延迟 | 每条代理连接一次 TCP+TLS 握手 | XMUX 复用，新请求 0-RTT，延迟更低 |
| 多线程测速 | 更强，每条连接独立拥塞窗口 | 不如 Vision，除非 `maxConcurrency: 1` |
| CPU / 吞吐 | Linux 下自动 Splice，内核直接转发 | 无 Splice，H2 帧处理走用户态 |
| 上下行分离 | 没有 | 有（需 packet-up/stream-up） |
| 中间盒/CDN | 不可能 | 本身为此设计 |
| 抗单连接时序分析 | Vision 内层握手随机填充 | padding + XMUX 随机化 + 多流混合 |

选择标准：纯直连、要单流拉满带宽、服务器 CPU 不富裕、跑 Linux，用 RAW + REALITY + Vision；网页浏览（大量小连接，0-RTT 收益直接）、要上下行分离、要过 CDN 或前置反代，用 XHTTP。纯抗封无定论：伪装主体是 REALITY，两者外看都是通往 target 的正常 TLS，XHTTP 额外提供抗分析手段和 IP 层腾挪空间，代价是性能。

XHTTP + REALITY 时 VLESS `flow` 留空。XTLS/Vision 只在 TCP+TLS/REALITY 下可用，启用 VLESS Encryption 后无底层限制，但非 TCP 拿不到 Splice。

### REALITY 能否套 CDN

不能，REALITY 的伪装靠客户端把认证数据藏在 ClientHello（`serverName` + `shortId` + `password` 对应的 x25519 公钥），服务端识别合法请求后借用 `target` 站的握手外观返回自签临时证书，鉴权失败的流量原样转发给 `target`。这要求客户端的 TLS 握手直接落在服务器上，而 CDN 用自己的证书跟客户端握手，ClientHello 到不了源站，REALITY 断在第一步。

能过 CDN 的是 XHTTP 传输层本身，但必须 `security: "tls"` 加自己域名的真证书，REALITY 和 CDN 是同一条连接上的二选一。

沾边的做法有三种：

1. 上下行分离混搭：上行 REALITY 直连、下行 CDN TLS H3，两个方向各自完整用自己那套传输安全，服务端按 UUID 关联
2. 同入站双入口：CDN 入口（TLS）和 REALITY 入口（直连）最终以同一 path 抵达同一 XHTTP 入站，客户端按网络环境选用
3. 纯四层转发：不终止 TLS 的 TCP 中继（realm/gost/iptables/HAProxy TCP 模式、Cloudflare Spectrum）。字节原样搬运，REALITY 握手完好，但没有 anycast 加速和 HTTP 缓存，抗封点转移到中继机 IP。此拓扑下服务端看到的源 IP 是中继机，要真实 IP 就在中继侧发 PROXY protocol、REALITY 侧配 `xver`

## 玩法与示例配置

以下示例共用基线结构：客户端 SOCKS 入站 + VLESS 出站，服务端 VLESS 入站 + freedom 出站。

### 基线：XHTTP + REALITY 直连

```jsonc title="服务端"
{
  "inbounds": [{
    "listen": "0.0.0.0",
    "port": 443,
    "protocol": "vless",
    "settings": {
      "users": [{ "id": "你的UUID" }],
      "decryption": "none"
    },
    "streamSettings": {
      "method": "xhttp",
      "xhttpSettings": { "path": "/yourpath" },   // mode 不填 = auto，三种模式都收
      "security": "reality",
      "realitySettings": {
        "target": "www.some-site.com:443",
        "serverNames": ["www.some-site.com"],
        "privateKey": "xray x25519 的 PrivateKey",
        "shortIds": [""]
      }
    }
  }],
  "outbounds": [{ "protocol": "freedom" }]
}
```

```jsonc title="客户端"
{
  "inbounds": [{ "listen": "127.0.0.1", "port": 10808, "protocol": "socks", "settings": { "udp": true } }],
  "outbounds": [{
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
  }]
}
```

### 过 CDN（TLS）

前提：cf1.domain.com 开橙云、CF 面板 SSL 模式为 Full (strict)，服务端持证书。

```jsonc title="服务端"
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

```jsonc title="客户端"
{
  "settings": { "address": "104.16.0.1", "port": 443, "id": "你的UUID", "encryption": "none" },
  "streamSettings": {
    "method": "xhttp",
    "xhttpSettings": { "path": "/yourpath" },
    "security": "tls",
    "tlsSettings": { "serverName": "cf1.domain.com", "fingerprint": "chrome" }
  }
}
```

H3 版只改一处 `alpn`：

```jsonc title="客户端"
"tlsSettings": { "serverName": "cf1.domain.com", "alpn": ["h3"], "fingerprint": "chrome" }
```

穿不过去时显式指定兼容性最强的模式：

```jsonc title="客户端"
"xhttpSettings": {
  "path": "/yourpath",
  "mode": "packet-up",
  "extra": {
    "scMaxEachPostBytes": "500000-1000000",   // 要小于 CDN 允许的最大请求体
    "scMinPostsIntervalMs": "10-50"
  }
}
```

客户端连 CF 边缘 IP，SNI 为 cf1，CF 用边缘证书（Universal SSL）握手。H2 版上行是流式 `POST /yourpath/UUID`（带 gRPC 伪装头，所以 CF 面板要开 gRPC 支持），下行是独立 `GET /yourpath/UUID`；CF 按 Host 回源到 VPS 的端口，验证 Origin 证书后转发给 Xray。H3 版客户端跑 quic-go QUIC，到 CF 那一跳被降成 H1/H2 回源，服务端无需监听 UDP。

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

```jsonc title="服务端"
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

#### 同一 CDN：上行 IPv4 H2，下行 IPv6 H3

只改客户端：

```jsonc title="客户端"
"streamSettings": {
  "method": "xhttp",
  "security": "tls",
  "tlsSettings": { "serverName": "cf1.domain.com", "fingerprint": "chrome" },
  "xhttpSettings": {
    "path": "/yourpath",
    "mode": "stream-up",          // 必须：stream-one 只有一个请求，分不开
    "extra": {
      "downloadSettings": {
        "address": "[2606:4700::1]",     // 优选出来的 IPv6
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

客户端随机生成 UUID，上行 `POST /yourpath/UUID` 走 IPv4 的 TCP+TLS+H2 到边缘 IP-A，下行 `GET /yourpath/UUID` 走 IPv6 的 QUIC H3 到边缘 IP-B。两个方向的源 IP、目标 IP、四层协议、HTTP 版本全不同。服务端按 path 中的 UUID 把两半缝合，30 秒内没缝上就终止会话。GFW 基于单条连接的检测只能看到半条流。

#### 同域域前置

先分清三个地址字段，一次 XHTTP over CDN 的请求里它们互相独立：

| 字段 | 是什么 | 谁看得见 | 决定什么 |
|---|---|---|---|
| `address` | 实际拨号目标 | 链路上所有人 | 包发到哪个 IP（优选 IP 填这里） |
| `tlsSettings.serverName` | TLS ClientHello 的 SNI | 明文，GFW 和 CDN 都看得见 | CDN 用哪张证书握手 |
| `xhttpSettings.host` | HTTP Host 头（H2/H3 为 `:authority`） | TLS 加密内，只有 CDN 看得见 | CDN 回源到哪台机器 |

SNI 与 Host 不一致即域前置；两者是同一 zone 内不同子域即同域域前置。跨 zone 的域前置 CF 已封，同 zone 内没有问题。

以 cf1 为上行门面、cf2 为下行门面、cf3 为共同 Host，三个均橙云、指向同一 VPS：

```jsonc title="客户端"
"xhttpSettings": {
  "host": "cf3.domain.com",       // 客户端发送优先级 host > serverName > address
  "path": "/yourpath",
  "mode": "stream-up",
  "extra": {
    "downloadSettings": {
      "address": "104.16.0.2",    // 优选出来的 IPv6
      "port": 443,
      "method": "xhttp",
      "security": "tls",
      "tlsSettings": { "serverName": "cf2.domain.com", "alpn": ["h3"], "fingerprint": "chrome" },
      "xhttpSettings": { "host": "cf3.domain.com", "path": "/yourpath" }
    }
  }
}
```

上行 `tlsSettings.serverName` 填 `cf1.domain.com`。链路抓包看到的两条 TLS 握手 SNI 分别是 cf1 和 cf2，两个方向的 Host 都是 cf3，CF 按 cf3 回源到你的 VPS。

服务端没必要设 `host`。设了就会校验客户端发来的值，path 已经足够隐蔽，多一个校验只是多一个特征。`host` 不能写在 `extra.headers` 里，必须放在 `xhttpSettings` 这一层。

当 cf1 和 cf2 都橙云直指同一台 VPS 时，不填 `host` 也可以，各方向 Host 跟着自己的 SNI 走，CF 回源到同一台机器同一 path，照样按 UUID 缝合。需要第三个域名的场景：源站前有 Nginx 按 `server_name` 分流、只想为一个域名配回源规则（Origin Rules / Page Rules）、或想让两个方向走完全一样的回源逻辑。

#### 上行去程优 + 下行回程优，非对称 XMUX

```jsonc title="客户端"
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
      "address": "回程优的中转IP",
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

出站 `settings.address` 填去程优的 IP。上行所有 POST 复用同一条 TCP，省握手；下行每个 GET 各开一条 TCP，避开单连接拥塞窗口和队头阻塞；两个方向各走最优路径。

`downloadSettings` 的补充说明：

- 它是一套完整的 `streamSettings` 外加 `address`/`port`，`method` 必须为 `"xhttp"`（不可省略），`security` 可为 `"tls"` 或 `"reality"`
- 下行配置不继承上行的任何配置；连 XMUX 默认值 roll 出的具体数都是各自独立随机的，随时间推移上下行复用完全不对称，反分析效果更好
- `sockopt` 项也可被分享，但上行 `sockopt` 设 `"penetrate": true` 可覆盖下行，适合打 `mark` 的情况

#### 上行 REALITY 直连 + 下行过 CDN

最接近"REALITY 套 CDN"的做法。上下行必须落到同一个 XHTTP 入站，而一个入站只能有一种 `security`，所以 REALITY 和 TLS 的终结都挪到 XHTTP 入站前面。

服务端，两个入口一个入站：

```jsonc title="服务端"
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
    // 入口 A：REALITY 前门，占 443，非法 VLESS 首包一律回落到 1234
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
    }
}
```

客户端：

```jsonc title="客户端"
{
  "settings": { "address": "你的VPS_IP", "port": 443, "id": "你的UUID", "encryption": "none" },
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
          "address": "104.16.0.1",
          "port": 443,
          "method": "xhttp",
          "security": "tls",
          "tlsSettings": { "serverName": "cf1.domain.com", "alpn": ["h3"], "fingerprint": "chrome" },
          "xhttpSettings": { "path": "/yourpath" }
        }
      }
    }
  }
}
```

流量走向：上行 `POST /yourpath/UUID` 直连 VPS 443，先过 REALITY 鉴权，外部看是访问 `www.some-site.com`；解密后首包是 H2 preface 而非合法 VLESS，命中回落转给 127.0.0.1:1234。下行 `GET /yourpath/UUID` 走 CF 的 QUIC H3，CF 回源到 8443 的 Nginx 再转给同一个 1234。两方向按 UUID 汇合。

两个代价：`xver` 填 0 是因为 Nginx 那条路不发 PROXY protocol，入站不能强制要求它，REALITY 入口日志里源 IP 会是 127.0.0.1，并且链路多一跳就多一处能坏的地方。

### XMUX 调参指南

```jsonc title="客户端"
// 多线程测速前：一条底层连接只承载一个代理请求
"extra": { "xmux": {
  "maxConcurrency": 1, "maxConnections": 0, "cMaxReuseTimes": 0,
  "hMaxRequestTimes": 0, "hMaxReusableSecs": 0, "hKeepAlivePeriod": 0
}}

// 只用一条底层连接复用到底
"extra": { "xmux": {
  "maxConcurrency": 0, "maxConnections": 1, "cMaxReuseTimes": 0,
  "hMaxRequestTimes": 0, "hMaxReusableSecs": 0, "hKeepAlivePeriod": 0
}}
```

日常保持全 0。三个随机范围默认值相当于隔段时间换一条新 H2/H3 主连接，不会有 gRPC、HTTP 传输层始终复用同一条连接导致的断流体验，也没有连接数固定特征。

### Browser Dialer

```bash title="客户端"
XRAY_BROWSER_DIALER=127.0.0.1:8080 ./xray -c config.json
```

浏览器打开 `localhost:8080` 并保持。约束：

- `address` 必须是域名，要指定 IP 就改系统 hosts 或内置 DNS
- 整个 `tlsSettings` 失效，HTTP 版本由浏览器决定，`SNI == host == address`
- 浏览器到服务端必须直连；用 tun 的话在路由里给服务端地址单独一条 freedom，否则死循环

流量走向：Xray 不自己建 TLS，把 "连到 `https://cf1.domain.com/yourpath`" 这个动作交给页面里的 JS，浏览器用自己真实的网络栈和 TLS 指纹发出，数据经本地 WebSocket 回到 Xray，指纹是真的，代价是 JS 中转的性能损耗。

XHTTP 不能开 mux.cool，要压浏览器连接数就调大 XMUX 的 `maxConcurrency`。

### FinalMask 给 H3 调拥塞控制

```jsonc title="客户端"
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

XHTTP H3 无协商机制，用不了 `brutal`，只能用免协商的 `force-brutal`，它强制上行按 `brutalUp` 定速发包。只对自建 H3 直连有意义；过 CDN 时这些参数没有作用对象，CDN 那一跳的拥塞控制不由你决定。官方文档也不建议服务端裸跑 quic-go H3，更推荐藏在真 Nginx/Caddy 后面。

## 域名与 Cloudflare

橙云子域：CF 代理流量，可做 CDN 优选、域前置门面、回源目标。客户端握 TLS 时根本看不到 VPS 上的证书，CF 用自己的边缘证书握手；你的证书只用于 CF 回源那一跳。

灰云子域：CF 只做 DNS 解析、不代理。适合给直连/REALITY 节点当 `address`，只有灰云才解析出 VPS 真实 IP。

当面板 SSL 模式为 Flexible 时，CF 回源走明文 HTTP，Xray 服务端不配 TLS 也能 "正常用"，但 VLESS 载荷在 CF 机房到 VPS 的公网链路上是以明文形式传输的。建议使用 Full (strict) 并配证书。

回源端口需要是 [Cloudflare 支持的端口](https://developers.cloudflare.com/fundamentals/reference/network-ports/)，非标端口（比如 10086）需使用 Origin Rule 重写回源端口。

### 证书：ACME DNS-01 与 CF Origin CA

回源证书的两种获取方式。cf1/cf2 同属一个 zone，签一张 `*.domain.com`（可加主域）的通配符即可，Nginx 的 `server_name` 分流也能各自匹配上。

| | ACME + DNS-01 | Origin CA |
|---|---|---|
| 签发 | 命令行，需 API token | 面板点几下，复制粘贴 |
| 有效期 | 90 天，cron 自动续 | 15 年，无续期 |
| 谁信任 | 所有浏览器/系统 | 只有 CF |
| 额外依赖 | acme.sh + token 存 VPS | 无 |

#### ACME DNS-01 证书

1. 面板右上角头像 -> My Profile -> API Tokens -> Create Token -> Create Custom Token
2. Permissions：Zone -> DNS -> Edit，再加 Zone -> Zone -> Read
3. Zone Resources：Include -> Specific zone -> domain.com，最小权限，别选 All zones
4. Create 后 token 只显示一次，立刻保存。它等于该 zone 的 DNS 写权限，别进 git、别贴聊天记录
5. 记下 Account ID 和 Zone ID，在面板 domain.com 概述页右下角

验证 token 是否存活：

```shell
curl -s -H "Authorization: Bearer 你的token" https://api.cloudflare.com/client/v4/user/tokens/verify
```

6. 签发证书：

```shell
export CF_Token="你的token"
export CF_Account_ID="你的AccountID"
export CF_Zone_ID="你的ZoneID"

acme.sh --set-default-ca --server letsencrypt
acme.sh --issue --dns dns_cf -d "domain.com" -d "*.domain.com" --keylength ec-256
```

token 会被明文存进 `~/.acme.sh/account.conf` 供续期自动复用，机器需保证安全，如发生泄露需要在面板 Revoke。

7. 安装给 Xray：

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

- CF 掐断下行 100 秒无实际数据的 HTTP，长连接要做应用层保活（sshd 设 `ClientAliveInterval`）；stream-up 上行被掐，在服务端设置 `scStreamUpServerSecs`
- packet-up 和 `Referer` 长 padding 会刷出大量长日志，建议在反代软件里指定不记录
- `address` 填优选 IP 时 `serverName` 必填，且 IP 不能当 SNI，留空则无 SNI 扩展，CF 会拒
- REALITY 的 `target` 别偷 Cloudflare 类免费 CDN 的证书，否则服务器会沦为别人的加速节点；迫不得已就配 `limitFallbackUpload`/`limitFallbackDownload` 限速，但限速本身也是特征

## 结语

回头看，XHTTP 是 Xray 第一个原生传输层，一上来就整了波大的：各种姿势穿透中间盒，分包 POST、XMUX、上下行分离各自消掉一类特征，还能和 REALITY 互补着用。

**"Beyond REALITY 的意思并非是取代 REALITY，而是流行程度超越 REALITY"** 这话不算夸张，从 REALITY 直连到 CDN、Nginx 前置、双入口混搭，XHTTP 有能力做到全场景通吃。
