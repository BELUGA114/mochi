---
title: 让 Claude Code 长任务结束后通知用户
published: 2026-08-21
description: 用 hooks 和 ntfy.sh 让 Claude Code 在长任务结束后向手机推送通知。
image: ""
tags: [Claude Code, hooks, ntfy]
category: 工具
draft: false
lang: ""
---

## 起因

Claude Code 跑长任务时，人往往就去做自己的事了。

例如子代理编排型的任务，一条指令下去，拆计划、并行/串行派子代理、写代码、功能审查、质量审查，任务时间在几十分钟到几小时不定。等人回来一看会话早就结束在那儿等你了，白白浪费时间。

当任务结束时，让 Claude Code 往手机发一条通知就能很好地解决这个问题。但是直接和模型模型说 “任务结束后发消息通知我” 显然是没有任何稳定性的（几小时的任务下来模型早就忘了），所以应当选择 hooks 触发。

这里选择用免服务端的 [ntfy.sh](https://ntfy.sh) 做推送管道。

## 整体思路

Claude Code 提供两个关键钩子：

- `UserPromptSubmit`：每次有用户输入时触发
- `Stop`：每当 Claude 停下、把控制权交还时触发

最直接的想法是 `Stop` 一触发就推通知，但这样每个子代理的来回都会收到通知，而预期是在**整个任务收尾**时收到一条。

所以更合适的方案是：

1. `UserPromptSubmit` 记下任务开始时刻（`mark`）
2. `Stop` 时把这一轮的耗时累加进一个状态文件（`notify`）
3. **累计活跃时间**达到阈值后，派生一个独立的 `settle` 进程，进入一个静默窗口继续观察
4. 静默窗口内如果没有新的动静，判定任务结束，推送并清零；如果又有动静，窗口作废、重新等

状态存在临时目录下、以 `session_id` 命名的 JSON 文件里，`mark`/`notify`/`settle` 三个进程通过它协作。

### 合成消息不能算作「用户又输入了」

Claude Code 在后台子代理回报时，会注入 `<task-notification>` 这类合成消息，而它们走的是和真实用户输入一样的 `UserPromptSubmit` 通道。

如果计时逻辑把它们当成真实指令，子代理编排型的长任务每收到一次后台回报就被清零一次，永远攒不够阈值。最后表现是 5 分钟的单会话小任务有提醒，一个多小时的子代理编排型大任务反而没提醒。

所以计时钩子必须识别合成注入，优先看 hook 输入的 `prompt` 字段是不是以这些标记开头，为空时退回扫原始 stdin：

```
<task-notification>  <command-name>  <command-message>
<command-args>  <local-command-caveat>  <local-command-stdout>
```

合成消息的出现说明任务还在继续，所以要作废正在等待的 `settle`，真正的结束必须是主循环和后台都安静下来。

### 「主会话停下等子代理」和「主会话真的结束了」长得一模一样

主循环发起一个异步子代理后，自己会停下来等回报，这一刻就会触发 `Stop`，从钩子的角度看，它和任务彻底结束完全无法区分。

如果这时候就启动 `settle`，而后台子代理的回报时间并不确定，指定的静默窗口内不一定能等到下一条回报来作废它，于是任务中途就误报完成并清零了状态，等真正结束时反而一声不响。

解决方案是 `notify` 达到阈值后，先判断后台是否还有任务在跑，有就不启动 `settle` 进程；只有当 `Stop` 时后台安静下来才启动。

判据来自 `Stop` 的 stdin 字段，取两路信号的并集：

- **`background_tasks`**：检测实时后台任务清单（元素形如 `{id, type, status, description, command}`），如果 `status` 不在已结束的集合（`completed`/`failed`/`cancelled`/…）中就算有子代理在运行
- **`transcript_path`**：扫描 transcript 作为兜底，对已通过 `async_launched` 发起、但还没收到对应 `<task-id>` + `<status>completed` 回报的子代理进行计数（按任务开始时间过滤，不把上一个任务的残留算进来）

:::note
`Stop` 的 stdin 实测带这些字段：`session_id`、`transcript_path`、`cwd`、`stop_hook_active`、`background_tasks`、`last_assistant_message`。`session_id` 就是用作状态文件名的那个外层 session id。
:::

## 配置项

行为通过环境变量设置，写在 `settings.json` 的 `env` 里即可：

| 变量                        | 默认值           | 作用                                                         |
| --------------------------- | ---------------- | ------------------------------------------------------------ |
| `NTFY_THRESHOLD_MS`         | 300000（5min）   | 累计活跃时间达到它才可能发通知                               |
| `NTFY_QUIET_MS`             | 90000（90s）     | 达阈值后的静默窗口，窗口内无动静才判定结束                   |
| `NTFY_IDLE_RESET_MS`        | 600000（10min）  | 两条真实指令间隔超过它，视为新任务、清零重算                 |
| `NTFY_MAX_TRANSCRIPT_BYTES` | 33554432（32MB） | transcript 兜底扫描的体积上限，超过就只靠 `background_tasks` |
| `NTFY_DRY_RUN`              | 未设             | `=1` 走完整流程但不真推送（测试用）                          |
| `NTFY_DEBUG`                | 未设             | `=1` 把决策过程写进临时目录的 `claude-ntfy.log`              |

`NTFY_THRESHOLD_MS` 判定的是**累计活跃时间**，而非纯墙钟，`accMs` 在每次 `Stop` 累加距上一个锚点的时长：

- **子代理编排型任务**：主循环等子代理的墙钟也会累计进去，所以这类任务的 `accMs` 基本等于任务开始到现在的总时长
- **单会话任务**：你思考、离开的间隔（只要不超过 `IDLE_RESET_MS`）同样算进活跃时间，它衡量的是任务窗口内累计流逝的时间

## 接入方式

`settings.json` 里挂两个钩子：

```json title="~/.claude/settings.json"
{
  "env": {
    "NTFY_THRESHOLD_MS": "600000"   // 10分钟阈值
  },
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "command": "node \"C:\\Users\\<你>\\.claude\\hooks\\ntfy-notify.js\" mark",
            "timeout": 10,
            "type": "command"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "async": true,
            "command": "node \"C:\\Users\\<你>\\.claude\\hooks\\ntfy-notify.js\" notify",
            "timeout": 15,
            "type": "command"
          }
        ]
      }
    ]
  }
}
```

`Stop` 钩子挂 `async: true`，因为它可能派生 `settle` 子进程，不该阻塞主流程。

手机上安装 [ntfy](https://ntfy.sh) 软件，订阅一个 topic（建议使用随机或复杂的字符）即可。

## 完整实现

由 Claude 自行编写并验证，主题名和服务地址（`NTFY_TOPIC`、`NTFY_URL`）硬编码在脚本里。

```js title="~/.claude/hooks/ntfy-notify.js"
#!/usr/bin/env node
"use strict";

// 用法：node ntfy-notify.js mark | notify | settle <token>

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const NTFY_TOPIC = "你的-topic";
const NTFY_URL = "https://ntfy.sh";

const THRESHOLD_MS = envMs("NTFY_THRESHOLD_MS", 5 * 60 * 1000);
const QUIET_MS = envMs("NTFY_QUIET_MS", 90 * 1000);
const IDLE_RESET_MS = envMs("NTFY_IDLE_RESET_MS", 10 * 60 * 1000);
const MAX_TRANSCRIPT_BYTES = envMs(
  "NTFY_MAX_TRANSCRIPT_BYTES",
  32 * 1024 * 1024,
);
const DRY_RUN = process.env.NTFY_DRY_RUN === "1";
const DEBUG = process.env.NTFY_DEBUG === "1";

// Claude Code 注入的合成消息，与真实用户输入走同一个 UserPromptSubmit 通道
// 必须排除在计时之外，否则子代理编排型长任务会被每次后台回报反复清零，永远攒不够阈值
const SYNTHETIC_MARKERS = [
  "<task-notification>",
  "<command-name>",
  "<command-message>",
  "<command-args>",
  "<local-command-caveat>",
  "<local-command-stdout>",
];

// status 落在这里才算结束；其余一律按"还在跑"处理
const DONE_STATUSES = new Set([
  "completed",
  "complete",
  "done",
  "failed",
  "error",
  "cancelled",
  "canceled",
  "killed",
  "timeout",
]);

const LOG_FILE = path.join(os.tmpdir(), "claude-ntfy.log");

function envMs(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function log(msg) {
  if (!DEBUG) return;
  try {
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
}

function logError(where, err) {
  // 发送失败已无处上报，但绝不能连失败本身都静默吞掉，至少留个痕迹能查
  try {
    fs.appendFileSync(
      LOG_FILE,
      `${new Date().toISOString()} ERROR ${where}: ${err && err.message}\n`,
    );
  } catch {}
}

function stateFile(sessionId) {
  return path.join(os.tmpdir(), `claude-ntfy-${sessionId || "default"}.json`);
}

function readState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, "utf8"));
    return s && typeof s === "object" ? s : null;
  } catch {
    return null;
  }
}

function writeState(file, state) {
  // 先写临时文件再改名：mark/notify/settle 三个进程可能同时读改写，原子替换避免读到半截 JSON
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, file);
  } catch (err) {
    logError("writeState", err);
  }
}

function blankState(prev) {
  return {
    taskStart: null,
    lastSeen: (prev && prev.lastSeen) || null,
    anchor: null,
    accMs: 0,
    cwd: (prev && prev.cwd) || "",
    token: crypto.randomUUID(),
    pending: false,
    pendingAt: 0,
  };
}

function isSynthetic(input, raw) {
  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  if (prompt.trim()) {
    return SYNTHETIC_MARKERS.some((m) => prompt.trimStart().startsWith(m));
  }
  // prompt 缺失时退回扫原始报文，这样即便 Claude Code 改了字段名，本判断也不会静默失效
  return SYNTHETIC_MARKERS.some((m) => raw.includes(m));
}

function hasLiveBackgroundWork(input, state) {
  // 信号 1：Claude Code 的实时后台任务清单，能覆盖被 resume 的子代理
  const tasks = Array.isArray(input.background_tasks)
    ? input.background_tasks
    : [];
  const running = tasks.filter(
    (t) => t && !DONE_STATUSES.has(String(t.status || "").toLowerCase()),
  );
  if (running.length > 0) {
    log(
      `live: background_tasks 有 ${running.length} 个未结束（${running.map((t) => t.id).join(",")}）`,
    );
    return true;
  }

  // 信号 2：兜底，防某些版本的 background_tasks 不枚举子代理
  const out = outstandingAgents(
    input.transcript_path,
    state && state.taskStart,
  );
  if (out > 0) {
    log(`live: transcript 有 ${out} 个已发起未回报的异步子代理`);
    return true;
  }
  return false;
}

function outstandingAgents(transcriptPath, since) {
  if (!transcriptPath || typeof transcriptPath !== "string") return 0;
  let text;
  try {
    const st = fs.statSync(transcriptPath);
    if (st.size > MAX_TRANSCRIPT_BYTES) {
      // transcript 过大时全量读会拖慢每次 Stop，宁可放弃兜底也不阻塞主流程
      log(`outstandingAgents: transcript 过大(${st.size}B)，跳过兜底`);
      return 0;
    }
    text = fs.readFileSync(transcriptPath, "utf8");
  } catch (err) {
    log(`outstandingAgents: 读 transcript 失败 ${err && err.message}`);
    return 0;
  }

  const launched = new Set();
  const finished = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = Date.parse(j.timestamp || "") || 0;

    const tur = j.toolUseResult;
    if (tur && tur.isAsync && tur.status === "async_launched" && tur.agentId) {
      // 按 taskStart 过滤，否则上一个任务残留的子代理会被算进这次，永远压制通知
      if (!since || ts >= since) launched.add(tur.agentId);
    }

    if (j.origin && j.origin.kind === "task-notification") {
      const content = j.message && j.message.content;
      const s = typeof content === "string" ? content : "";
      const idMatch = s.match(/<task-id>([^<]+)<\/task-id>/);
      const statusMatch = s.match(/<status>([^<]+)<\/status>/);
      const status = statusMatch ? statusMatch[1].trim().toLowerCase() : "";
      if (
        idMatch &&
        (status === "completed" || status === "failed" || status === "error")
      ) {
        finished.add(idMatch[1]);
      }
    }
  }

  let n = 0;
  for (const id of launched) if (!finished.has(id)) n++;
  return n;
}

function mark(input, raw, file) {
  if (isSynthetic(input, raw)) {
    // 合成注入不动计时，但它说明活儿还在继续，所以作废正在等待的 settle，等真正安静下来再判结束
    const prev = readState(file);
    if (prev && prev.pending) {
      prev.pending = false;
      prev.token = crypto.randomUUID();
      writeState(file, prev);
      log("mark: synthetic activity, cancelled pending settle");
    } else {
      log(`mark skipped (synthetic): ${raw.slice(0, 100)}`);
    }
    return;
  }
  const now = Date.now();
  const prev = readState(file);
  const gap = prev && prev.lastSeen ? now - prev.lastSeen : Infinity;
  // 两条真实指令间隔过长视为新任务：上一个任务早已结束，累计值不该带到这次
  const newTask = !prev || !prev.taskStart || gap > IDLE_RESET_MS;

  const state = newTask ? blankState(prev) : prev;
  state.taskStart = newTask ? now : state.taskStart;
  state.anchor = now;
  state.lastSeen = now;
  state.cwd = input.cwd || state.cwd || "";
  state.pending = false; // 新指令作废正在等待的 settle：token 变了，它醒来后会自己退出
  state.token = crypto.randomUUID();
  writeState(file, state);
  log(`mark ${newTask ? "new-task" : "continue"} acc=${state.accMs}ms`);
}

function notify(input, file) {
  const state = readState(file);
  if (!state || !state.taskStart) {
    log("notify: no active task, skip");
    return;
  }
  const now = Date.now();
  const from = state.anchor || state.taskStart;
  state.accMs = (state.accMs || 0) + Math.max(0, now - from);
  state.anchor = now;
  state.lastSeen = now;

  if (state.accMs < THRESHOLD_MS) {
    writeState(file, state);
    log(`notify: acc=${Math.round(state.accMs / 1000)}s below threshold`);
    return;
  }

  // 主循环停下等子代理这一刻和"任务真的结束"从钩子看无法区分，靠后台是否有活来区分：
  // 有活就作废 settle、继续累计，留到它们都安静下来的那次 Stop 再启动，避免中途误报
  if (hasLiveBackgroundWork(input, state)) {
    state.pending = false;
    state.token = crypto.randomUUID();
    writeState(file, state);
    log(
      `notify: 后台仍有活，压制 settle，acc=${Math.round(state.accMs / 1000)}s`,
    );
    return;
  }

  // 超过三个静默窗口还没回来才认为上一个 settle 子进程已死，避免重复派生
  const pendingStale =
    state.pending && now - (state.pendingAt || 0) > QUIET_MS * 3;
  if (state.pending && !pendingStale) {
    writeState(file, state);
    log("notify: settle already pending");
    return;
  }

  state.pending = true;
  state.pendingAt = now;
  writeState(file, state);
  spawnSettle(state.token, file);
  log(`notify: armed settle acc=${Math.round(state.accMs / 1000)}s`);
}

function spawnSettle(token, file) {
  // 钩子进程有超时会被回收，把静默窗口的等待放进 detached 子进程才不受它约束；
  // 子进程 stdio 是 ignore 读不到 stdin，所以状态文件路径走 argv 传进去
  const child = spawn(process.execPath, [__filename, "settle", token, file], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

async function settle(token, file) {
  await new Promise((r) => setTimeout(r, QUIET_MS));

  // token 对不上说明这段静默期内有新动静把它顶掉了，直接退出；多个 settle 竞争时只有最新的会推送
  const state = readState(file);
  if (!state || state.token !== token || !state.pending) {
    log(`settle: superseded (token ${token})`);
    return;
  }

  const mins = Math.max(1, Math.round((state.accMs || 0) / 60000));
  const project = state.cwd ? path.basename(state.cwd) : "";

  if (DRY_RUN) {
    log(`settle: DRY_RUN would send "${project}" ${mins}min`);
  } else {
    try {
      const res = await fetch(NTFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: NTFY_TOPIC,
          title: project ? `Claude Code - ${project}` : "Claude Code",
          message: `任务完成，耗时约 ${mins} 分钟`,
        }),
      });
      await res.text();
      log(`settle: sent status=${res.status} mins=${mins}`);
      if (!res.ok) throw new Error(`ntfy 返回 ${res.status}`);
    } catch (err) {
      // 发送失败不清零累计值，下一次 Stop 会重新派生 settle 再试，一次网络抖动不至于永久丢掉通知
      logError("ntfy send", err);
      const cur = readState(file);
      if (cur && cur.token === token) {
        cur.pending = false;
        writeState(file, cur);
      }
      return;
    }
  }

  const cur = readState(file);
  if (cur && cur.token === token) writeState(file, blankState(cur));
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "mark" && mode !== "notify" && mode !== "settle")
    process.exit(0);

  let raw = "";
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch {}
  let input = {};
  try {
    input = JSON.parse(raw);
  } catch {
    // stdin 不是合法 JSON 时按无上下文处理，仅影响通知文案与项目名，不影响判断逻辑
  }
  const file = stateFile(input.session_id);

  if (mode === "mark") mark(input, raw, file);
  else if (mode === "notify") notify(input, file);
  else await settle(process.argv[3], process.argv[4] || file);
}

main().catch((err) => logError("main", err));
```

## 实现细节

- **`settle` 用 `detached + unref` 派生**，不跑在钩子进程里。钩子有超时、会被回收
- **`token` 机制**：每次启动 `settle` 生成一个新 token 写进状态；`settle` 醒来后比对 token，对不上就说明期间有新动静把它顶掉了，直接退出。这样多个 `settle` 竞争时只有最新的那个会真正推送
- **状态文件先写临时文件再 rename**：`mark`/`notify`/`settle` 三个进程可能同时读改写，原子替换避免读到半截 JSON
- **推送失败不清零**：`accMs` 保留，下一次 `Stop` 会重新派生 `settle` 再试，网络抖动不会永久丢掉通知
- **可接受的边界**：如果某个子代理被强杀、从此不再回报，`background_tasks` 会一直认为它在运行而压制这次通知。但这会在你下一条真实指令时自愈（两条真实指令间隔超过 `IDLE_RESET_MS`）
