---
title: 境外 VPS 上的分流，别拿一份表回答另一个问题
published: 2026-08-30
description: geosite 的 cn 表是为「境内客户端该用哪个解析器」建的，把它搬到境外服务端做境内外出站判定，误判是普遍存在的。境内外交给 IP 判定，域名表只用来选解析器。
tags: [Xray, 分流, DNS, VPS]
category: 网络
draft: false
---

## 环境与说明

洛杉矶的一台 VPS，Xray-core v26.6.1。配置和日志里那个叫 `warp` 的出站是保守侧的中转，它可以是 Cloudflare WARP 或其他出站，不重要。

文中的域名数据来自 [@Loyalsoldier/v2ray-rules-dat](https://github.com/Loyalsoldier/v2ray-rules-dat) 的 `geosite.dat`，构建日期 2026-08-30。换个上游或者换个构建时间，具体条目会有出入。

::github{repo="Loyalsoldier/v2ray-rules-dat"}

下面假设读者自己写过分流规则，知道域名规则和 IP 规则各自什么时候生效。示例是 Xray 的服务端配置，不过整套思路和内核无关，sing-box 和 mihomo 一样能落地，客户端也适用，只是方向要反过来，后面会分别提到。

:::important[这套东西的边界]
它解决的是分流判定结果可不可控，不解决隐私。绕行路径上的中转方照样看得见那部分流量，目标站点照样记录出口 IP，要那个级别的保护得用 Tor。
:::

## 一条走错的连接

先看日志里这两行：

```log title="access.log" {2}
22:49:06.215554 UDP:223.5.5.5:53 got answer: ocsp.globalsign.com. -> [111.124.70.137] 1.007003029s
22:49:06.215573 accepted tcp:ocsp.globalsign.com:80 [inbound-443 -> warp]
```

一台放在洛杉矶的服务器，却把 GlobalSign 的 OCSP 查询交给了阿里的境内 DNS，等了一秒拿回一个大陆地址，然后为了连它从 warp 绕了一跳出去。

我当时的处理是加一条例外。过了一段时间 `c.pki.goog` 也出同样的毛病，再加一条。到第三次的时候，我才想起来去看列表里到底写了什么。

看完发现这跟列表的维护质量没什么关系。每份列表都是为某个具体问题或在某个具体前提下建起来的，而我一直拿它回答的是另一个问题。

这篇文章写的就是怎么认出这种错位，以及怎么把配置改成即使列表出错，损失的也只有速度。

## geosite 的 cn 表里都收了什么

Xray 官方文档对这张表的说法是「大杂烩，只要沾点中国关系的都往里丢」（[routing-with-dns](https://xtls.github.io/document/level-1/routing-with-dns.html)）。

把两张表拉出来对一遍，能看到不少域名同时命中：

```text title="同时出现在 cn 与 geolocation-!cn 里的域名" {4}
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

所以一个域名归哪一侧，列表本身给不出答案，答案在规则顺序里。内核按顺序匹配，`full:` 写得比 `domain:` 精确也没用，先匹配上的那条赢。

这些条目并没有写错。对一个在北京的客户端，把 `www.gstatic.com` 当境内域名是合理的，它确实有境内节点，直连比走代理快得多，这份表本来就是为这个场景建的。

这个归类也不是没人质疑，[PR#328](https://github.com/Loyalsoldier/v2ray-rules-dat/pull/328) 就是一次未合并的 README 措辞之争：提议方觉得这类域名该单独成表，理由是客户端直连它们有 IP「送中」的风险，维护者不认可。

那它什么时候变成错的呢？把同一份表搬到洛杉矶的服务端，「做路由决策的机器在中国」这个前提就没了，`www.gstatic.com` 被归进 `geosite:cn` 也就从优势变成了累赘。

列表出问题，一种是滞后，域名换了托管或 IP 段被重新分配，列表还没跟上，这种靠提高更新频率和多源取并集能缓解，`geoip` 的毛病基本都在这一类。

另一种是前提不匹配，社区建这张表要解决的问题和你的需求不是一回事，这种靠更新永远解决不了，因为列表根本没错，只能换表或者换判据。域名表里这一类占的分量不小，而且往往要等某个域名坏掉才会发现一个。

## 境内外交给 IP 判断

平时容易混在一起的，其实是不同层面的几个问题：

1. 这条连接的目的 IP 落在哪一侧？只取决于地址本身。
2. 这个域名由哪一侧的节点提供服务？取决于从哪里问，以及权威 DNS 怎么回。
3. 这个域名属于谁，会不会被干扰？这是策略问题，和地理位置相关但不等价。

`geosite:cn` 回答的是第二个，而且前提是提问的人在中国。拿它去回答第一个，得到的就是上面那次误判。

境内外分流的判定应该落在 IP 上，在一台不希望直连境内的服务器上这个理由尤其充分：要防的事情发生在 TCP 连接上，服务器用自己的 IP 连上京东的大陆地址，暴露就产生了，而连它的海外边缘节点不会（代理回国流量不安全这件事社区讨论过很多，也有[实测](https://github.com/net4people/bbs/issues/129#issuecomment-1308102504)）。

由此有两个推论容易踩，客户端服务端都成立。

一是 IP 规则不命中并不代表规则失效。`www.jd.com` 用境外解析器拿到的是 `140.150.36.51`，京东的海外边缘节点，这个地址本来就不在境内 IP 表里，`geoip:cn` 那条当然不触发。总有人以为是分流没生效，然后跑去改 DNS 想把它「修好」。

二是指向默认出站的例外规则，等于把排在它后面的检查全关掉了。规则表末尾总有一个兜底出站，例外规则如果指的正是那一侧，它要么纯属冗余，要么就是抢在真正的判定规则之前把判定跳过。给 `gstatic.com` 加一条直连例外去治「它被 geosite 当成 cn 域名」这个症状，属于后者，从此这个域名的连接根本不看目的 IP。

### 反过来也会错：过度保守

我加过一条「所有 `.cn` 顶级域走绕行」，想给 IP 表可能漏掉的段补一层覆盖。日志里它长这样：

```log title="access.log —— 护住空集的保守规则" {1}
22:48:45.314016 accepted tcp:nvidia.cn:443 [inbound-443 -> warp]
22:48:45.855421 UDP:223.5.5.5:53 got answer: nvidia.cn. -> [34.194.97.138, 34.200.2.98] 540.916769ms
22:48:45.949233 DOH//1.1.1.1 got answer: nvidia.cn. -> [34.200.2.98, 34.194.97.138] 94.292403ms
```

`nvidia.cn` 解析出来是两个 AWS 美东地址，直接连过去本来就不会有任何暴露。这条规则护住的是个空集，还让流量从 warp 多绕了一跳。保守方向的误判不危险，但也不是没代价，值不值得看各人需求。

:::note[为什么 accepted 排在 DNS 之前]
`accepted` 那一行排在两条 DNS 之前，是因为域名规则命中的时候路由用不着解析，后面那两次是出站为了建连接自己做的。这个细节讲时序的时候还要用。
:::

比换列表更省事的一步，是换成不需要列表的判据。例如在客户端分流的场景下，对于微信和 QQ 这类程序，与其枚举腾讯的域名段（会滞后，而且它们的 CDN 域名还和别人共用），不如直接写进程规则，Xray 里的字段是 `process`，这些字段来源于自己的环境，不存在滞后问题。

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

很多内核都有这么个机制：把某批域名交给某个解析器，同时给返回结果加一个条件，不满足就换下一个解析器。Xray 里对应的字段是 `expectedIPs`。

它很容易被读成「让这些域名解析出符合条件的 IP」。实际上它只是个过滤器，解析器返回什么它就在里面挑，不合条件的地址丢掉，全丢完了就回落到下一台。想要的答案解析器不给，它也变不出来。

上一节 `nvidia.cn` 那三行正好是它正常工作的样子：223.5.5.5 返回两个 AWS 美东地址，`expectedIPs: ["geoip:cn"]` 把它们全滤掉，结果为空，于是回落到 DoH 再问一次。

麻烦的是错误答案本身就满足过滤条件的时候，过滤器根本不会动。`www.gstatic.com` 从境内解析器拿到的是 Google 的大陆段，`expectedIPs: ["geoip:cn"]` 顺利通过，IP 规则照样把它送去 warp 多绕一跳，结果和按 `geosite:cn` 分流一模一样，只是成因换了。

:::warning[`finalQuery` 和 `expectedIPs` 不要一起开]
Xray 的 `finalQuery` 为真的时候后面的解析器不再参与，而过滤到空恰恰要靠后面的解析器来兜。两个一起开，一次过滤失败就等于解析失败，域名直接连不上。
:::

如果只是想要「过滤但别彻底失败」，`expectedIPs` 里可以放一个 `*` 条目，过滤后为空时保留原始结果。它比 `finalQuery` 温和得多，代价是错误答案会被放行，所以这是给宁可慢也别断的场景用的，拿它做白名单校验会出事。

要让 DNS 层真的帮上忙，办法是把精确的列表排在宽列表前面，让它先接管。Xray 构建解析器列表的顺序是：命中 `domains` 条件的解析器按配置顺序排在前面，其余没标 `skipFallback` 的按配置顺序追加，第一个产出非空结果的解析器终止查询。所以只要把精确列表挂在一个不带过滤的解析器上并排在宽列表之前，过滤和截断都用不着出现。

<iframe src="https://mermaid.live/embed?theme=dark&look=classic&mode=dark#pako:eNqFks1OwkAUhV9lctflBbowEcrPA7jCcTGhFQiUkgIrIDFGozHB1IiJIj82ouJCiC4US5CX6bT1LZwp1rQudHZzc-45370zTchpsgIi5HVSLaAtCeu4gtjZ3Mbgzd6c5306GlGjg2EHxWIbKN7EQM-W9vzJfflwzalnTjC0g64417QwOJczDC2U8E3umIbO3qnVdXsH3sOtMzTo1URA9rxDT2681ZGzGDP7wCPh52R566pLr4cCosdjOu25i3NnMAoJgzBq3PMw6YeMTpdRLCmKlfwDK-Sf9EFSzJZHD_ufez0Gu-Z1Bqa9eA1FpKIR2d_1dRs1Tu255T5aXJNmGGw-z1iGQqXoUOmgnvZhMrzlsE-ti__3mFnvEQT2tkUZxLreUARQFV0l_ApsrnpBURUMIgaZ6CUMAoayppX8Sq5MarVijo3IHKqkktU0NTDRtUa-AOIuKdfYrVGVSV2RioT9oW9J-wvwiQTT" width="100%" height="480" style="border:0" loading="lazy" title="Mermaid diagram" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe>

:::caution[`enableParallelQuery` 会破坏这里依赖的顺序语义]
这套做法整个建立在顺序语义上。Xray 的 `enableParallelQuery` 打开之后会改成按分组并发，相邻且 `clientIP`、`skipFallback`、`queryStrategy`、`tag`、`domains`、过滤条件全都相同的服务器合成一组，组内谁先成功就用谁的地址，只有组间才按顺序回落。开了它，前面那一条就不一定排得到前面去，两个别一起用。
:::

客户端上这个策略同样有用，也是大多数人最熟悉的，只是方向反过来。想让 Steam 的下载走直连，商店和社区走代理，做法是把 `steam@cn` 排在 `steam` 前面；想让 `gstatic.com` 直连而 `google.com` 走代理，做法是把 `google-cn` 排在 `google` 前面。都是让精确表排在前面把域名截走，都用不着写单个域名的例外。

:::note[题外话：客户端上 FakeIP 造成的判据错位]
用 FakeIP 的时候连接目标是域名而不是 IP，能不能在客户端靠 IP 表分流，取决于内核有没有在这一步补一次解析，各家行为不一样。不补解析的话，那些不在域名表中但解析得到境内 IP 的域名会一路落到 final。这个话题本文不展开。
:::

### 换一份为这个问题建的表

这份 `geosite.dat` 里，`cn` 有十一万条出头，绝大部分来自 `china-list`，也就是 dnsmasq-china-list 的 accelerated-domains，剩下的是 `geolocation-cn` 五千多条 `tld-cn` 四十九条，以及 apple.china 和 google.china 这两个 opt-in 文件。

dnsmasq-china-list 要回答的问题本身就是「哪些域名用境内解析器解析更好」。Apple 和 Google 在它那里是单独的 opt-in，因为它清楚这两家的境内节点该不该走境内解析，得看使用者的场景。这个取舍和「在服务端只用域名表来选解析器」的需求天生对得上。

所以要问的既然是「用哪个解析器」，就该找一份为「用哪个解析器」建的表，而不是让一份为出站分流建的表来兼职。给通用列表打补丁，只能修掉已经发现的条目；换一份对题的列表，能连还没发现的一起修掉。

:::tip[关于精确表怎么设计]
外国 CA 那三条 OCSP 域名性质不一样，值得分开看：

- `ocsp.globalsign.com`，`cn` 和 `china-list` 都收，必须单列。
- `c.pki.goog`，`cn` 收（`full:c.pki.goog`）而 `china-list` 不收，换表就够了，留着是防以后漂移。
- `ocsp.digicert.com`，两张表都不收，它只在 `geolocation-!cn` 里，为它写例外起不到任何作用，删掉。

要不要单独处理 OCSP 还得看客户端。Chrome 对叶证书不做在线 OCSP，走的是 CRLSets，Let's Encrypt 也在 2025 年停掉了 OCSP 服务并从证书里移除了 OCSP URL；但 Windows 和 Safari 还是会查，在那些客户端上它确实卡在 TLS 握手的关键路径上，一秒的境内解析加一跳绕行是能感觉到的。
:::

对应的 DNS 配置：

```jsonc title="config.json —— dns" {9, 23, 25}
"dns": {
  "queryStrategy": "UseIPv4",
  "servers": [
    // 第一条，精确表前置：外国公司在境内提供服务的那批子表，交给境外解析器，不加过滤。
    // 有人会问这条是不是多余的，毕竟下面用的 china-list 本来就不收 Apple 和 Google。
    // 不多余：它挡的是上游列表以后的漂移，而 china-list 确实收 ocsp.globalsign.com。
    {
      "address": "https://1.1.1.1/dns-query",
      "tag": "dns-foreign-in-cn",
      "domains": [
        "geosite:google-cn", "geosite:apple-cn", "geosite:microsoft@cn", "geosite:steam@cn",
        "domain:ocsp.globalsign.com", "domain:c.pki.goog"
      ],
      "skipFallback": true            // 只服务命中的域名，不参与其他域名的回落
    },
    // 第二条，境内解析器。finalQuery 必须保持 false：expectedIPs 过滤到空时得有下一条来兜。
    // clientIP 是 per-server 的 EDNS Client Subnet 字段（全局那个键叫 clientIp），
    // 只有需要境内服务解析到大陆地址时才加，代价见下面一段。
    {
      "address": "223.5.5.5",
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

:::caution[一处可能多余的保守]
为了让保守规则命中，曾试过给境内解析器设一个中国的 EDNS Client Subnet，让国内公司的服务返回大陆地址，这样 IP 规则就会命中，绕行也就生效了。技术上完全可行，实测也有效。

但这些域名从境外解析本来会落到海外边缘节点，直连过去入境流量是零；设了 ECS 之后，等于先造出一条入境流量，再把它藏到绕行路径后面。零暴露总比藏起来的暴露好，所以这个改动值不值，取决于要防的到底是「被识别成代理」还是「不让对方看到代理 IP」，前者用不上它。
:::

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

缓存里那条大陆记录哪来的，日志里没有直接记录，我猜是境内解析器的应答在超时判定之后才到，仍然被写进了缓存。

出站再解析一次不是默认行为。Xray 的 freedom 出站 `domainStrategy` 默认 `AsIs`，这时它直接把域名交下去，只有设成 `UseIP*` / `ForceIP*`，或者用了 `sockopt.domainStrategy`，才会有第二次内置查询，才撞得上缓存。我这台设了，所以窗口存在。

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

| 类别 | 例子 | 用来发现什么 |
| --- | --- | --- |
| 外国公司的境内服务 | www.gstatic.com, dl.google.com, www.apple.com, ocsp.globalsign.com, c.pki.goog | 前提不匹配造成的误判 |
| 真正的境内服务 | www.baidu.com, www.bilibili.com, www.taobao.com | 前面那条精确表有没有把该走境内的也截走 |
| `.cn` 顶级域 | www.gov.cn, nvidia.cn, mirrors.tuna.tsinghua.edu.cn | 顶级域规则的覆盖和误判 |
| 境外对照组 | github.com, www.youtube.com, www.cloudflare.com | 规则有没有串 |

清 DNS 缓存最省事的办法是重启一次 Xray。批量跑的话把域名丢进一个文件：

```bash title="批量触发"
while read -r d; do curl -sI --max-time 5 "https://$d" >/dev/null; done < domains.txt
```

跑完再用上面两条 sed 回头扫日志，逐个对期望。测服务端行为的时候客户端要切到全局模式，不然一半域名根本到不了服务端。

## 两次误诊

开头那三条例外算一次误诊，症状是某个域名走错，以为是列表条目写错了。

第二次误诊在网络层。保守侧如果是 Cloudflare WARP 出站，先把 MTU 调下来：Xray 的 wireguard 出站默认 1420，但 Cloudflare 自家客户端用的是 1280。默认值在这条链路上偏大，境外站点几 KB 的 ServerHello 拆成满载的段之后就进不来了，症状是 TLS 卡在收不到第一个响应上，间歇发作，按时间和次数都找不到规律。

具体到这次：客户端用 `www.gstatic.com/generate_204` 测延迟，而服务端把这个地址分流去了 warp，于是 vless + ws + 套 Cloudflare CDN 的那批节点延迟全部超时，发作也没有任何规律。

在列表上修了很久才发现问题在网络层。它最初的表现是「加上按域名分流的规则就复现，删掉就好」，看着像稳定复现，实际上那条规则只是把流量送上了一条本来就半坏的路径，它是必要条件，但不是原因。

顺手把 `keepAlive` 设成 25，这条出站平时几乎空闲，握手过期后重新握手要是撞上丢包，就够让一个 5 秒超时的探测失败。

## 总结

- 先确认社区建这张表要解决的问题，和自己的需求是不是一回事。
- 服务端对境内外的判定适合用 IP，选解析器才用域名表，而且要用专为选解析器而建的表。

这样列表滞后带来的后果，就从「某天某个域名会走错，而且可能是有风险的那个方向」变成「某天某个域名会慢一点，扫一遍日志就能发现」。

## 附录：完整配置

`warp` 是保守侧的中转出站，`direct` 是默认出站。

```json title="config.json（完整）" showLineNumbers collapse={5-23, 29-33} {46, 48}
{
  "dns": {
    "queryStrategy": "UseIPv4",
    "servers": [
      {
        "address": "https://1.1.1.1/dns-query",
        "tag": "dns-foreign-in-cn",
        "domains": [
          "geosite:google-cn", "geosite:apple-cn", "geosite:microsoft@cn", "geosite:steam@cn",
          "domain:ocsp.globalsign.com", "domain:c.pki.goog"
        ],
        "skipFallback": true
      },
      {
        "address": "223.5.5.5",
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
      { "type": "field", "inboundTag": ["dns-remote", "dns-remote-backup"], "outboundTag": "direct" },
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






