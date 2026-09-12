---
title: VPS 上的分流：境内外判断交给 IP，域名只用来选解析器
published: 2026-08-30
description: geosite 的 cn 表是为客户端建的，把它搬到服务端做境内外出站判定，误判是普遍存在的。
image: "./cover.png"
tags: [Xray, 分流, DNS, VPS]
category: 网络
draft: false
---

## 环境与说明

Xray v26.6.1，配置里的 `warp` 出站是保守侧的中转，它可以是 Cloudflare WARP 或其他出站，不重要。

文中的域名数据来自 [@Loyalsoldier/v2ray-rules-dat](https://github.com/Loyalsoldier/v2ray-rules-dat) 的 `geosite.dat`，构建日期 2026-08-30。换个上游或者换个构建时间，具体条目会有出入。

::github{repo="Loyalsoldier/v2ray-rules-dat"}

下面假设读者自己写过分流规则，知道域名规则和 IP 规则各自什么时候生效。示例是 Xray 的服务端配置，不过整套思路和内核无关，sing-box 和 mihomo 一样能落地，客户端也适用，只是方向要反过来。

## geosite 的 cn 里有什么

Xray 官方的教程对这张表的描述是 [「大杂烩，只要沾点中国关系的都往里丢」](https://xtls.github.io/document/level-1/routing-with-dns.html)

把两张表拉出来对一遍，能看到不少域名同时命中：

```text title="同时出现在 cn 与 geolocation-!cn 里的域名"
CN                full:www.gstatic.com
CN                full:www.apple.com
CN                full:init.itunes.apple.com
CN                full:ocsp.apple.com
CN                full:dl.google.com
CN                full:fonts.gstatic.com
CN                full:c.pki.goog

GEOLOCATION-!CN   domain:gstatic.com
GEOLOCATION-!CN   domain:www.apple.com
GEOLOCATION-!CN   domain:init.itunes.apple.com
GEOLOCATION-!CN   domain:ocsp.apple.com
GEOLOCATION-!CN   domain:dl.google.com
GEOLOCATION-!CN   domain:fonts.gstatic.com
GEOLOCATION-!CN   domain:c.pki.goog
```

`ocsp.globalsign.com` 的情况稍有不同，它只命中 `cn` 里的 `domain:globalsign.com`。

条目这样写是存在合理性的。对于一个在北京的客户端，把 `fonts.gstatic.com` 当境内域名是合理的，Google Fonts（谷歌字体）服务确实有境内节点，直连比走代理快得多。

那它什么时候就不适用了呢？把同一份表搬到洛杉矶的服务端，「做路由决策的机器在境内」这个前提就没了，这些域名被归进 `geosite:cn` 也就从优势变成了误判。

这种归类也不是没人质疑，[PR#328](https://github.com/Loyalsoldier/v2ray-rules-dat/pull/328) 的提议方觉得这类域名该单独成表，理由是客户端直连它们有 IP「送中」的风险，维护者不认可。

## 境内外交给 IP 判断

平时容易混在一起的，其实是不同层面的几个问题：

1. 这条连接的目的 IP 落在哪一侧？只取决于地址本身。
2. 这个域名由哪一侧的节点提供服务？取决于从哪里问，以及权威 DNS 怎么回。
3. 这个域名属于谁，会不会被干扰？这是策略问题，和地理位置相关但不等价。

`geosite:cn` 回答的是第二个，而且前提是提问的人在境内。

境内外分流的判定应该落在 IP 上，在一台不希望直连境内的服务器上这个理由尤其充分，要防的事情发生在 TCP 连接上，服务器用自己的 IP 连上京东的大陆地址，暴露就产生了，而连它的海外边缘节点不会（代理回国流量有风险这件事社区讨论过很多，也有[实测](https://github.com/net4people/bbs/issues/129#issuecomment-1308102504)），不过 **这只对跨境链路上的观测方成立**，站在服务提供方那一侧要另算。

比换列表更省事的一步，是换成不依赖社区维护的判据，例如在客户端分流的场景下，对于微信和 QQ 这类程序，与其枚举腾讯的域名段（会滞后，而且它们的 CDN 域名还和别人共用），不如直接写进程规则。

这节对应的路由配置：

```jsonc title="config.json —— routing" {2, 9}
"routing": {
  "domainStrategy": "IPIfNonMatch",   // 域名规则不命中时解析成 IP 再匹配，IP 判据靠它生效
  "rules": [
    // api 必须在 geoip:private 之前，否则 API 自己的连接（目的是 127.0.0.1）会被拦掉
    { "type": "field", "inboundTag": ["api"], "outboundTag": "api" },
    { "type": "field", "inboundTag": ["dns-remote", "dns-remote-backup"], "outboundTag": "direct" },
    { "type": "field", "ip": ["geoip:private"], "outboundTag": "blocked" },
    { "type": "field", "protocol": ["bittorrent"], "outboundTag": "blocked" },  // 需要 inbound 开 sniffing
    { "type": "field", "ip": ["geoip:cn"], "outboundTag": "warp" }
    // 到这里结束，一条指向 direct 的例外都没有，因为 direct 就是默认出站
  ]
}
```

境内解析器那一项的查询目的地是 `223.5.5.5`，会被最后那条 IP 规则兜住走 `warp`，用不着也不应该为它单独写一条直连。

## 域名表只用来选解析器

很多内核都有这么个机制：把某批域名交给某个解析器，同时给返回结果加一个条件，不满足就换下一个解析器，Xray 里对应的字段是 `expectedIPs`。

它很容易被读成「让这些域名解析出符合条件的 IP」，实际上它只是个过滤器，解析器返回什么它就在里面挑，不合条件的地址丢掉，全丢完了就回落到下一台。

麻烦的是错误答案本身就满足过滤条件的时候，过滤器根本不会动。`www.gstatic.com` 从境内解析器拿到的是 Google 的大陆段，如果过滤器是 `expectedIPs: ["geoip:cn"]` 会顺利通过，结果和按 `geosite:cn` 分流一模一样，只是成因换了。

:::warning[`finalQuery` 和 `expectedIPs` 不要一起开]
Xray 的 `finalQuery` 为真的时候后面的解析器不再参与，而过滤到空恰恰要靠后面的解析器来兜，两个一起开，一次过滤失败就等于解析失败。

如果只是想要「过滤但别彻底失败」，`expectedIPs` 里可以放一个 `*` 条目，过滤后为空时保留原始结果。它比 `finalQuery` 温和得多，但是错误答案也会被放行，所以这是给宁可慢也别断的场景用的，拿它做白名单校验会出事。
:::

Xray 构建解析器列表的顺序是：命中 `domains` 条件的解析器按配置顺序排在前面，其余没标 `skipFallback` 的按配置顺序追加，第一个产出非空结果的解析器终止查询。所以只要把精确列表挂在一个不带过滤的解析器上并排在宽列表之前，过滤和截断都用不着出现。

<iframe
  src="https://mermaideditor.com/embed?code=Z3JhcGglMjBURCUwQSUyMCUyMCUyMCUyMEElNUIlMjIlRTglQUYlQjclRTYlQjElODIlRTUlOUYlOUYlRTUlOTAlOEQlMjIlNUQlMjAtLSUzRSUyMEIlN0IlMjIlRTUlOTElQkQlRTQlQjglQUQlRTclQjIlQkUlRTclQTElQUUlRTglQTElQTglMjIlN0QlMEElMjAlMjAlMjAlMjBCJTIwLS0lM0UlN0MlMjIlRTYlOTglQUYlMjIlN0MlMjBDJTVCJTIyJUU4JUFGJUE1JUU4JUExJUE4JUU1JUFGJUI5JUU1JUJBJTk0JUU3JTlBJTg0JUU4JUE3JUEzJUU2JTlFJTkwJUU1JTk5JUE4JTJDJTIwJUU0JUI4JThEJUU1JThBJUEwJUU4JUJGJTg3JUU2JUJCJUE0JTIyJTVEJTBBJTIwJTIwJTIwJTIwQyUyMC0tJTNFJTIwWiU1QiUyMiVFOCVCRiU5NCVFNSU5QiU5RSUyQyUyMCVFNSU4OCVBNCVFNSVBRSU5QSVFNyVCQiU5MyVFNiU5RCU5RiUyMiU1RCUwQSUyMCUyMCUyMCUyMEIlMjAtLSUzRSU3QyUyMiVFNSU5MCVBNiUyMiU3QyUyMEQlN0IlMjIlRTUlOTElQkQlRTQlQjglQUQlRTUlQUUlQkQlRTglQTElQTglMjIlN0QlMEElMjAlMjAlMjAlMjBEJTIwLS0lM0UlN0MlMjIlRTYlOTglQUYlMjIlN0MlMjBFJTVCJTIyJUU4JUFGJUE1JUU4JUExJUE4JUU1JUFGJUI5JUU1JUJBJTk0JUU3JTlBJTg0JUU4JUE3JUEzJUU2JTlFJTkwJUU1JTk5JUE4JTIyJTVEJTBBJTIwJTIwJTIwJTIwRSUyMC0tJTNFJTIwRiU3QiUyMiVFNyVCQiU5MyVFNiU5RSU5QyVFOSU4MCU5QSVFOCVCRiU4NyVFOCVCRiU4NyVFNiVCQiVBNCVFNiU5RCVBMSVFNCVCQiVCNiUyMiU3RCUwQSUyMCUyMCUyMCUyMEYlMjAtLSUzRSU3QyUyMiVFNiU5OCVBRiUyMiU3QyUyMFolMEElMjAlMjAlMjAlMjBGJTIwLS0lM0UlN0MlMjIlRTglQkYlODclRTYlQkIlQTQlRTUlOTAlOEUlRTQlQjglQkElRTclQTklQkElMjIlN0MlMjBHJTVCJTIyJUU1JTlCJTlFJUU4JTkwJUJEJTIyJTVEJTBBJTIwJTIwJTIwJTIwRCUyMC0tJTNFJTdDJTIyJUU1JTkwJUE2JTIyJTdDJTIwRyUwQSUyMCUyMCUyMCUyMEclMjAtLSUzRSUyMEglNUIlMjIlRTUlODUlOUMlRTUlQkElOTUlRTglQTclQTMlRTYlOUUlOTAlRTUlOTklQTglMkMlMjAlRTQlQjglOEQlRTUlOEElQTAlRTglQkYlODclRTYlQkIlQTQlMjIlNUQlMEElMjAlMjAlMjAlMjBIJTIwLS0lM0UlMjBa&theme=neutral"
  width="100%"
  height="650"
  frameborder="0"
  style="border-radius:8px;overflow:hidden"
></iframe>

:::caution[`enableParallelQuery` 会破坏这里依赖的顺序语义]
这套做法整个建立在顺序语义上。Xray 的 `enableParallelQuery` 打开之后会改成按分组并发，相邻且 `clientIP`、`skipFallback`、`queryStrategy`、`tag`、`domains`、过滤条件全都相同的服务器合成一组，组内谁先成功就用谁的地址，只有组间才按顺序回落。开了它，前面那一条就不一定排得到前面去，两个别一起用。
:::

客户端上这个策略同样有用，也是大多数人最熟悉的，只是方向反过来。想让 Steam 的下载走直连，商店和社区走代理，做法是把 `steam@cn` 排在 `steam` 前面；想让 `gstatic.com` 直连而 `google.com` 走代理，做法是把 `google-cn` 排在 `google` 前面。都是让精确表排在前面把域名截走，都用不着写单个域名的例外。

### 换一份为这个问题建的表

这份 `geosite.dat` 里，`cn` 有十一万条多，绝大部分来自 `china-list`，也就是 dnsmasq-china-list 的 accelerated-domains，剩下的是 `geolocation-cn` 和 `tld-cn`，以及 apple.china 和 google.china 这两个 opt-in 文件。

dnsmasq-china-list 要回答的问题是「哪些域名用境内解析器解析更好」，Apple 和 Google 在它那里是单独的 opt-in，这个取舍和「在服务端只用域名表来选解析器」的需求对得上。

换了表之后，还得挑出哪些域名要在精确表里单列，比如 OCSP 域名的收录情况就不一样：

- `ocsp.globalsign.com`，`cn` 和 `china-list` 都收，必须单列。
- `c.pki.goog`，`cn` 收（`full:c.pki.goog`）而 `china-list` 不收，换表就够了，留着是防以后漂移。

要不要单独处理 OCSP 还得看客户端。Chrome 对叶证书不做在线 OCSP，走的是 CRLSets，Let's Encrypt 也在 2025 年停掉了 OCSP 服务并从证书里移除了 OCSP URL；但 Windows 和 Safari 还是会查，在那些客户端上它确实卡在 TLS 握手的关键路径上，一秒的境内解析加一跳绕行是能感觉到的。

### 设 ECS 防的是哪一种暴露

为了让保守规则命中，可以给境内解析器设一个境内的 EDNS Client Subnet，让国内公司的服务返回大陆地址，IP 规则就会命中，绕行也就生效了。

上述域名虽然从境外解析会落到海外边缘节点，不存在回国流量，但提供服务的仍然是国内公司，例如使用代理登录微信、支付宝等行为会留下一条机房 IP 和一个国内身份的关联记录，这是存在风险的。

机器直连海外边缘节点留下的是机器的 IP，而走 ECS 并分流绕行至保守侧留下的是中转方的 IP，直接缓解了上述风险。但在实际中，搭建服务端的人有这个意识，用的人未必有，分流出问题，或者干脆故意连国内服务，代价都会记在机器的 IP 上。

这使得在服务端考虑这样的策略是有必要的，虽然 ban 掉所有回国流量也能解决风险，但代价是会影响用户的使用体验，[官方文档](https://xtls.github.io/document/level-2/warp.html) 选 WARP 而不选黑洞也是这个理由。

不过要强调的是，这一套只是服务端的兜底。真正兼顾使用体验和安全的配置在客户端：用 `process` 进程名规则或者分应用代理。

对应的 DNS 配置：

```jsonc title="config.json —— dns" {9, 20, 23, 25}
"dns": {
  "queryStrategy": "UseIPv4",
  "servers": [
    // 精确表前置：外国公司在境内提供服务的那批子表，交给境外解析器。
    // 这是多余的吗，毕竟下面用的 china-list 本来就不包含 Apple 和 Google。
    // 不算多余，这是在预防上游列表以后的漂移。
    {
      "address": "https://1.1.1.1/dns-query",
      "tag": "dns-foreign-in-cn",
      "domains": [
        "geosite:google-cn", "geosite:apple-cn", "geosite:microsoft@cn", "geosite:steam@cn",
        "domain:ocsp.globalsign.com", "domain:c.pki.goog"
      ],
      "skipFallback": true            // 只服务命中的域名，不参与其他域名的回落
    },
    // 境内解析器：finalQuery 必须保持 false：expectedIPs 过滤到空时得有下一条来兜。
    // clientIP 是 per-server 的 EDNS Client Subnet 字段（全局那个键叫 clientIp），
    {
      "address": "223.5.5.5",
      "clientIP": "",   //填一个境内 ISP 的IP地址
      "tag": "dns-cn",
      "domains": ["geosite:china-list"],
      "expectedIPs": ["geoip:cn"],
      "skipFallback": true,
      "finalQuery": false
    },
    // 兜底，不加任何条件
    { "address": "https://1.1.1.1/dns-query", "tag": "dns-remote" },
    { "address": "https://8.8.8.8/dns-query", "tag": "dns-remote-backup" }
  ]
}
```

## 应用层判定的两个漏洞

前面所有判定都跑在应用层，而应用层有两个漏洞绕不开。

常见的那个是多地址。`IPIfNonMatch` 下一个域名解析出多个地址时，每条 IP 规则会拿全部地址去试，任一命中就算命中。日志里 `www.bilibili.com` 一次返回 20 个地址，只要其中一个满足 `expectedIPs: ["geoip:cn"]`，整条连接就走保守侧，而实际建连用的可能是另一个地址。

另一个是时序：

```log title="access.log —— 判定用海外 IP，建连用大陆 IP" {3-4}
22:49:13.697898 UDP:223.5.5.5:53 got answer: www.jd.com. -> [] 4.000179582s <app/dns: record not found>
22:49:14.108768 DOH//1.1.1.1 got answer: www.jd.com. -> [140.150.36.51, 138.113.102.14] 411.088937ms
22:49:14.108794 accepted tcp:www.jd.com:443 [inbound-443 >> direct]
22:49:14.108804 UDP:223.5.5.5:53 cache HIT: www.jd.com. -> [1.194.193.81]
```

境内解析器 4 秒超时返回空，这一步和 `expectedIPs` 无关，是结果为空导致的回落。回落到境外解析器拿到海外节点，路由据此判了直连。10 微秒后出站为了建连接又解析了一次，这次命中缓存拿到 `1.194.193.81`，一个大陆地址。判定用的是海外 IP，连接用的是大陆 IP。

缓存里那条大陆记录从哪来，日志没有直接记下，可能是境内解析器的应答在超时判定之后才到，仍然被写进了缓存。

出站再解析一次不是默认行为。Xray 的 freedom 出站 `domainStrategy` 默认 `AsIs`，这时它直接把域名交下去，只有设成 `UseIP*` / `ForceIP*`，或者用了 `sockopt.domainStrategy`，才会有第二次内置查询，才撞得上缓存。附录里的 `direct` 设了 `UseIPv4`，所以这个窗口存在。

只要有两个解析器对同一个域名给出不同答案，而其中一个不稳定，这个窗口就在，而且在配置层面消不掉。

### 再加一道不读列表的闸

上面那个窗口说明光靠内核里的判定还不够，得在内核之外补一道防火墙级的闸：只看物理网卡的出站，目的地址落在一个独立维护的 CN 地址集合里就拦截。这个地址集合最好来源和内核不同并定时刷新，跟内核自带的数据形成两份并集。

这道闸补不上数据本身的遗漏，它防的是判定逻辑的时序问题和规则顺序错误，以及未来折腾配置时的手滑。

客户端上对应的东西是 kill-switch 那一类：TUN 模式配 strict route，把 final 指向保守出站之类的，只是形态不一样，思路是一致的。

### 验证

要判断列表行为，需要拿到域名、应答的解析器、返回的 IP 和最终出站，Xray 可以这么过滤：

```bash title="从 access.log 里抽出判定结果"
# 域名 + 出站
sed -nE 's#.*accepted tcp:([^ ]+) \[([^]]*)\].*#\2\t\1#p' access.log | sort -u

# 域名 + 解析器 + IP
sed -nE 's#.*(DOH//[^ ]+|UDP:[^ ]+) (got answer|cache HIT): ([^ ]+)\. -> \[([^]]*)\].*#\3\t\1\t\4#p' access.log | sort -u
```

被路由规则命中的连接是 `[inbound-443 -> warp]`，落到默认出站的是 `[inbound-443 >> direct]`。

然后批量跑一组期望明确的域名，下面四类都要有：

| 类别               | 例子                                                                           | 用来发现什么                           |
| ------------------ | ------------------------------------------------------------------------------ | -------------------------------------- |
| 外国公司的境内服务 | www.gstatic.com, dl.google.com, www.apple.com, ocsp.globalsign.com, c.pki.goog | 前提不匹配造成的误判                   |
| 真正的境内服务     | www.baidu.com, www.bilibili.com, www.taobao.com                                | 前面那条精确表有没有把该走境内的也截走 |
| `.cn` 顶级域       | nvidia.cn, mirrors.tuna.tsinghua.edu.cn                                        | 顶级域规则的覆盖和误判                 |
| 境外对照组         | github.com, www.youtube.com, www.cloudflare.com                                | 规则有没有串                           |

清 DNS 缓存最省事的办法是重启一次 Xray。批量跑的话把域名丢进一个文件：

```bash title="批量触发"
while read -r d; do curl -sI --max-time 5 "https://$d" >/dev/null; done < domains.txt
```

跑完再用上面两条 sed 回头扫日志，逐个对期望。测服务端行为的时候客户端要切到全局模式，不然一半域名根本到不了服务端。

## 总结

- 先确认社区建这张表要解决的问题，和自己的需求是不是一回事。
- 服务端对境内外的判定适合用 IP，选解析器才用域名表，而且要用专为选解析器而建的表。
- 对于服务端，IP 是比通用域名分类更合适的判据，但它仍然受 DNS、CDN、多地址、缓存、时序影响。

这样列表滞后带来的后果，就从「某天某个域名会走错，而且可能是有风险的那个方向」变成「某天某个域名会慢一点，扫一遍日志就能发现」。

:::important[这套东西的边界]
它解决的是分流判定结果可不可控，不解决隐私。绕行路径上的中转方照样看得见那部分流量，目标站点照样记录出口 IP，要那个级别的保护得用 Tor。
:::

## 附录：完整配置

`warp` 是保守侧的中转出站，`direct` 是默认出站。

如果要用 `warp` 出站需要注意：

`mtu` 写的是 1280，Xray 的 wireguard 出站默认值 1420 在这条链路上偏大，境外站点几 KB 的 ServerHello 拆成满载的段之后就进不来了，症状是 TLS 卡在收不到第一个响应上，间歇发作且按时间和次数都找不到规律，而 Cloudflare 自家客户端用的就是 1280。

`keepAlive` 写 25，是因为这条出站平时几乎空闲，握手过期后重新握手要是撞上丢包，就够让一个 5 秒超时的探测失败。

```json title="config.json（完整）" showLineNumbers collapse={5-24, 30-34}
{
  "dns": {
    "queryStrategy": "UseIPv4",
    "servers": [
      {
        "address": "https://1.1.1.1/dns-query",
        "tag": "dns-foreign-in-cn",
        "domains": [
          "geosite:google-cn",
          "geosite:apple-cn",
          "geosite:microsoft@cn",
          "geosite:steam@cn",
          "domain:ocsp.globalsign.com",
          "domain:c.pki.goog"
        ],
        "skipFallback": true
      },
      {
        "address": "223.5.5.5",
        "clientIP": "", //填一个境内 ISP 的IP地址
        "tag": "dns-cn",
        "domains": ["geosite:china-list"],
        "expectedIPs": ["geoip:cn"],
        "skipFallback": true,
        "finalQuery": false
      },
      { "address": "https://1.1.1.1/dns-query", "tag": "dns-remote" },
      { "address": "https://8.8.8.8/dns-query", "tag": "dns-remote-backup" }
    ]
  },
  "routing": {
    "domainStrategy": "IPIfNonMatch",
    "rules": [
      { "type": "field", "inboundTag": ["api"], "outboundTag": "api" },
      {
        "type": "field",
        "inboundTag": ["dns-remote", "dns-remote-backup"],
        "outboundTag": "direct"
      },
      { "type": "field", "ip": ["geoip:private"], "outboundTag": "blocked" },
      { "type": "field", "protocol": ["bittorrent"], "outboundTag": "blocked" },
      { "type": "field", "ip": ["geoip:cn"], "outboundTag": "warp" }
    ]
  },
  "outbounds": [
    {
      "protocol": "freedom",
      "tag": "direct",
      "settings": { "domainStrategy": "UseIPv4" }
    },
    {
      "protocol": "wireguard",
      "tag": "warp",
      "settings": {
        "mtu": 1280,
        "secretKey": "...",
        "peers": [{ "publicKey": "...", "endpoint": "...", "keepAlive": 25 }]
      }
    },
    { "protocol": "blackhole", "tag": "blocked" }
  ]
}
```
