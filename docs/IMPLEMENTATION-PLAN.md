# Transom 实现方案

状态：已定稿，进入实现
日期：2026-11-07
上游文档：[README.md](../README.md)（定位、竞品、引擎调研）
本文回答 README 第 12 节留下的开放问题，并把路线图摊到可执行的粒度。

---

## 0. 结论先行

Transom 是一个 Claude Code function-hooks 插件。它把外部应用压成一对接口——`snapshot()` 读结构化状态、`act()` 执行结构化动作——同一对接口同时供**人**（会话侧栏）和**模型**（`mcp__transom__*` 工具）使用，动作全部经过能力协商、焦点仲裁、权限门和审计。

第一版只做一个 provider：**无头 Chromium（CDP）**。它同时是产品能力的证据和 provider 合同的试验场。合同从第一天起按"多 provider"写，但不在第一版落第二个 provider。

三个开放问题的裁决：

| 问题 | 裁决 |
|---|---|
| tmux 边界 | tmux 管会话存活和终端分屏；Transom 管**应用内部**的焦点、滚动、寻址。两者不重叠：Transom 不提供终端复用，tmux 不提供 DOM。 |
| 微信第一波？ | 不做。首个 provider 必须**有协议**（CDP），无 PTY 的硬约束下，TUI 抓屏类目标推迟到合同稳定后。 |
| 确认粒度 | provider 级默认值 + 动作分级：只读动作放行；写动作默认每次确认（可在 config 里按 provider 切成 `once` / `auto`）；导航到白名单外域名永远确认。 |

## 1. 目标与非目标

### 1.1 验收目标（本仓库完成时）

1. 在交互式 Claude Code 会话中，`/transom open <url>` 打开一个侧栏面板，面板内是人可读、可点的应用快照。
2. 模型可调用 `transom_snapshot` / `transom_act` / `transom_screenshot`，与人在同一个动作队列里操作同一页面；模型的每次动作在面板内可见、留痕。
3. 快照是结构化、稳定寻址的（每个可交互节点有本次快照内稳定的 ref），不是截图猜测。
4. 权限白名单生效：非白名单域名、`file:`、非 http(s) 协议被拒并说明原因。
5. 全部动作进审计（谁、何时、对哪个 ref、结果），审计可从会话里读出。
6. 进程监督：Chrome 崩溃不拖垮会话，面板显示错误态并可重连；`session.end` 杀干净进程树。
7. 降级：窄终端/tmux 下自动落文本档；键盘能力不可用时隐藏键盘足迹。
8. `claude plugin validate` 通过，`tsc --noEmit` 通过，`claude plugin test` 通过。

### 1.2 非目标（第一版）

- 终端模拟器、多路复用器、独立宿主。
- 像素级保真、音视频、多标签。
- 第三方 provider 分发机制（目录已留，先锁在核心）。
- 云端/移动 surface 的完整交互（只保证不崩，桌面与终端优先）。

## 2. 竞品校正与本项目的位置

（由独立调研核对 README 第 4 节，结论见 §2.3；逐条数据在 `docs/COMPETITORS.md`。）

### 2.1 已核实的近邻

- **sandipchitale/browser-pane**：会话内浏览器标签，明确不含 DOM 读取与点击驱动 → 只有"看"。
- **open-claude-in-chrome / safari-mcp / cdpilot / browser-debugger-cli / chrome-devtools-mcp / playwright MCP**：模型能驱动，窗口在会话外 → 人看不见，且人在另一窗口点的时候模型不知道。
- **pinkpixel-dev/claude-workspace、repoviewer、cli-mod**：文件域面板，不碰外部应用。
- **Claude Code 桌面版的预览面板**：给人看，模型点按钮仍靠截图/盲猜，且到不了 SSH 远端。

### 2.2 真正空出的位置

2026-07 起 [zenbu-labs/terminal-browser](https://github.com/zenbu-labs/terminal-browser)（MIT，4.5k★）已经做出"会话内浏览器 + 模型动作"：kitty graphics 离屏渲染、`/browser`、动作走 `agent-browser` CLI。Claude Code 桌面版也内建了 DOM 级 Browser pane。所以空位不是"会话里有浏览器"，而是：

1. **provider 无关的框架**：能力协商、焦点令牌、supervisor、白名单、审计——竞品都只有浏览器，没有合同。
2. **注册工具而非 shell CLI**：`mcp__transom__*` 有类型化输入输出，不走 Bash 权限弹窗，不吃 shell 引号。
3. **人机同一条动作队列**：同一来源标记、同一把焦点、同一份审计；terminal-browser 的工具只把 URL 交给模型，再由模型自己敲 CLI。
4. **远端与 tmux 一等公民**：渲染降级到纯文本，不依赖 kitty graphics；terminal-browser 在 tmux 下失效且坐标报错。

### 2.3 危险点（实现时必须守住）

- **terminal-browser 吸收浏览器场景**：差异化押在框架、注册工具、远端可用性和审计；浏览器 provider 只做到够用，不拼渲染保真。
- **上下文爆炸**：整页 DOM 轻松几十万字符。默认只给可见区 + 地标摘要 + 硬上限，整页按需。
- **headless 没有登录态**：临时干净 profile 起步；需要登录时用一次性交互窗口或导入 cookie，不默认接管用户浏览器。
- **桌面版重叠**：本地、要排版时让位；文案不宣称替代浏览器。
- **页面提示注入**：快照一律当不可信输入；导航前后都校验协议/主机；写动作默认确认。
- **引擎 early access**：所有 `$` 触碰收在 `engine/adapter.ts`，接口变更只改一层。
- **Chrome 供应链**：只连本机已安装浏览器；不下载二进制；启动参数最小化。

## 3. 架构

### 3.1 分层与依赖方向

单向依赖，只有 `engine/` 碰 `$`，只有 `providers/` 碰外部应用，`hub/` 居中。

```
.claude-plugin/plugin.json     清单
hooks/hooks.json               模块声明
hooks/main.tsx                 唯一注册点：装配、生命周期、把事件转给 hub
engine/                        引擎适配层（唯一 import 'claude-code' 与使用 $ 的地方）
  adapter.ts                   $ 的类型化薄壳 + 版本探测 + 特性开关
  supervisor.ts                子进程起停、探活、退避、进程树清理
  frame-clock.ts               有订阅才走钟，空闲停钟
  focus.ts                     全局焦点令牌
  render.ts                    快照 → 文本树 / Raster 的公共渲染器
hub/
  registry.ts                  provider 注册表（本期只注册 browser）
  negotiate.ts                 能力协商与降级决策
  permissions.ts               协议/域名/路径白名单、动作分级、确认
  audit.ts                     审计环形缓冲（$.store 持久 + 会话内查询）
  actions.ts                   人/模型共用的动作队列（串行、带来源）
providers/browser/
  contract.ts                  provider 合同的具体实例（capabilities、白名单元数据）
  client.ts                    与 bridge 的 HTTP 客户端（token、超时、重连）
  snapshot.ts                  快照的裁剪 / 压缩 / 渲染用投影
  render.tsx                   面板 Client 模块（绘制 + 指针/键盘 → post）
  meta.ts                      尺寸门槛、启动参数、探测
bridge/                        Node 侧（被 supervisor 以子进程启动，不被引擎 import）
  bridge.mjs                   HTTP 服务：/health /snapshot /act /shot /navigate，token 校验
  cdp.mjs                      最小 CDP 客户端（WebSocket，无第三方依赖）
  page-agent.mjs               注入页面的快照/动作实现（函数源码字符串）
  paths.mjs                    Chrome 发现
demo/
  server.mjs                   静态服务器 + 演示应用
  app.html                     可控的演示页（表单、列表、延迟、遮蔽、滚动）
tests/                         插件测试（claude-code/testing）与 bridge 单测
docs/
  IMPLEMENTATION-PLAN.md       本文
  COMPETITORS.md               竞品核对数据
  SECURITY.md                  威胁模型与检查表
  PROVIDERS.md                 provider 作者指南
```

### 3.2 provider 合同

```ts
type Capabilities = {
  pointer: boolean; keys: boolean; scroll: boolean; images: boolean;
  text: boolean; minCols: number; minRows: number;
};

type SnapshotRequest = { scope: 'viewport' | 'document'; maxChars: number };
type Snapshot = {
  provider: string; url: string; title: string; capturedAt: number;
  viewport: { cols: number; rows: number; scrollX: number; scrollY: number };
  capabilities: Capabilities;
  landmarks: Array<{ role: string; name: string; ref?: string }>;
  nodes: Array<SnapshotNode>;          // 可见区，文档序
  truncated: { nodes: number; reason: string };
};

type SnapshotNode = {
  ref: string;                          // 本次快照内稳定，如 "e12"
  role: string;                         // button/link/textbox/heading/text/image/...
  name: string;                         // 无障碍名或文本，已压缩空白
  value?: string;                       // 表单值（密码遮蔽）
  state?: { disabled?: true; checked?: boolean; expanded?: boolean;
            selected?: boolean; focused?: true };
  bounds: { x: number; y: number; w: number; h: number };
  depth: number;
};

type Action =
  | { kind: 'click'; ref: string }
  | { kind: 'fill'; ref: string; text: string }
  | { kind: 'select'; ref: string; value: string }
  | { kind: 'press'; key: string }
  | { kind: 'scroll'; dx: number; dy: number }
  | { kind: 'hover'; ref: string }
  | { kind: 'navigate'; url: string }
  | { kind: 'back' } | { kind: 'forward' } | { kind: 'reload' };

type Provider = {
  id: string;
  capabilities: Capabilities;
  start(opts: StartOptions): Promise<void>;
  stop(): Promise<void>;
  isAlive(): Promise<boolean>;
  snapshot(req: SnapshotRequest): Promise<Snapshot>;
  act(a: Action, ctx: ActContext): Promise<ActResult>;
  screenshot?(): Promise<{ pngBase64: string; cols: number; rows: number }>;
};
```

`act` 返回 `{ ok, changed, message, auditId }`；`changed` 让面板决定要不要立刻重取快照。任何 provider 抛错都归一成 `ActResult` 的错误态，不向上炸。

### 3.3 动作流向

```
人点击面板 ──ui.message──┐
                         ├─→ hub/actions.enqueue(actor, action)
模型调用工具 ─tool.call──┘        │
                                 ├─ permissions.classify → allow/ask/deny
                                 │        └─ ask → $.ui.ask（逐次或会话记忆）
                                 ├─ audit.begin(actor, action)
                                 ├─ provider.act
                                 ├─ audit.end(result)
                                 └─ 面板刷新（人操作时同样回显到转录状态行）
```

队列串行、可插队（人的点击优先于排队中的模型动作）、每个动作带 `actor: 'person' | 'model'`。来源同时写进审计和 `$.ui.log` 的短行。

### 3.4 焦点令牌

- 全局唯一 `FocusToken`：`{ holder: 'prompt' | 'pane'; since }`。
- 点击面板取得；`Esc` 无条件交还（`closeOnEscape: false`，Esc 只还焦）。
- 只有持有令牌时 `surface.onKey` 才把按键转发给 provider；不持有时的指针事件仍作为 pointer 转发（`fine` 坐标换算成 CSS px）。
- `turn.complete` 不卸载面板、不抢焦。

### 3.5 渲染与降级

- 文本档（默认）：`Box/Text/Button` 构成的列表，按 `role` 着色，ref 作为可点击 key。
- 彩色格档（M2）：`Raster` 铺可见区缩略图（bridge 用 Chrome 自身 canvas 降采样成 u32 格子），叠一层极薄的 `Client` 收指针；只重画脏矩形。
- 真图像档（M3，可选）：支持 kitty/iterm2 的终端用 `Image`。
- 协商：`columns < minCols` 或 `rows < minRows` → 摘要行；tmux（无 `fine`）→ 去掉子格悬停精度；`keys=false` → 隐藏按键提示。
- 帧率：文本随动作/轮询（`every(800)`）刷新；Raster 限 4 fps；不可见/失焦停钟。

### 3.6 上下文策略

- 工具默认 `scope: 'viewport'`，硬上限 12000 字符（可配置到 30000）。
- 超出按重要度裁剪：先留 `landmarks` 和可交互节点，再截断文本节点，报告 `truncated`。
- `scope: 'document'` 显式请求时才给整页，且同样裁剪。
- 快照携带 `capturedAt` 与 `etag`（内容 hash）；模型重复取到相同页面时给短摘要。

### 3.7 权限模型

- 配置项（`plugin.json` `userConfig`，带默认值）：`allowedHosts`（逗号分隔，含 `localhost`）、`allowedSchemes`（默认 `https,http`）、`writePolicy`（`confirm` | `once` | `auto`，默认 `confirm`）、`snapshotMaxChars`。
- 每次 `navigate` 先解析 URL：协议不在白名单 → 拒；主机不在白名单 → 确认后可临时放行（会话内记忆）。
- 写动作（click/fill/select/press/back/forward/reload）按 `writePolicy`；只读（snapshot/screenshot/scroll/hover）不确认。
- 提交类动作（Enter、点击 `type=submit`）单独标注 `submits`，`confirm` 策略下即使 `once` 也再问一次。
- 所有确认走 `$.ui.ask`，拒绝即 `{ deny }`，模型收到原因。
- 凭证：不注入、不读出密码框值（快照里 `value: "••••"`）；需要登录的目标交给用户自己的浏览器配置目录（可选 `--user-data-dir`）。

### 3.8 审计

- 每条 `{ id, ts, actor, provider, kind, target, url, policy, result, durationMs }`。
- 内存环形 500 条 + `$.store` 持久 2000 条（跨会话），`/transom audit` 打印最近记录。
- 模型动作的 `tool.call` 结果里带 `auditId`；人动作在 `$.ui.status` 一闪。
- 失败、拒绝同样入账。

### 3.9 进程与崩溃

- `supervisor.start()`：Chrome 以 `--headless=new --remote-debugging-port=0 --user-data-dir=<临时> --no-first-run --disable-extensions --hide-scrollbars` 启动，读 `DevToolsActivePort` 拿端口。
- bridge 先起（stdout 首行 `{"ready":true,"port":N}`），再由它拉起 Chrome。
- 探活 `/health` 连续 2 次失败 → 杀掉、退避（250ms×2^n，封顶 8s，5 次后进 `failed` 态）。
- `session.end`、模块卸载、`/transom close` 都走 `stop()`：先 `Browser.close`，再杀进程树（Windows `taskkill /T /F`，其他 `kill(-pid)`）。
- 面板错误态含原因、重连按钮、最近审计。

### 3.10 引擎适配层

- `engine/adapter.ts` 导出窄接口：`pane.open/close`、`ui.askParagraph`、`tool.registerAll`、`store.get/set`、`log`、`status`、`spawn`、`fetch`。其余代码只认这些。
- 启动时 `$.session.version()` 记版本；未知大版本进保守模式（只开文本档）。
- 所有 hook 带 `.catch`，失败降级而不是吞掉（guard 模式按 reference.md 的写法）。

## 4. 里程碑与验收

| 里程碑 | 内容 | 验收 | 状态 |
|---|---|---|---|
| M0 探针 | 最小 manifest + 面板 + Client 指针 + 子进程 stdout 回显 | `validate` 通过；会话里面板可点、可打印坐标 | ✅ 完成 |
| M1 合同与 bridge | provider 合同、supervisor、bridge、CDP、快照/动作、演示页 | `node tests/bridge/*.mjs` 全绿：起浏览器、取快照、点、填、滚动、导航 | ✅ 完成（11 项集成测试） |
| M2 人与模型共用 | hub/actions、权限、审计、工具注册、面板交互、焦点 | `claude plugin test` 全绿；模型中点按钮与人中点按钮产生同样审计 | ✅ 完成（21 项测试） |
| M3 视觉档 | Raster 降采样、脏区重绘、Image 档 | 4 fps 下 10 秒无掉帧告警；坐标误差 ≤1 格 | ✅ 半格块 Raster 完成；脏区重绘与 Image 档未做 |
| M4 降级与崩溃 | 协商、错误面板、退避、进程树清理 | 杀 Chrome 后 8s 内恢复；窄终端落摘要行 | ✅ 协商/重启/空闲回收完成；真实杀进程冒烟待人工执行 |
| M5 文档与打包 | INSTALL、SECURITY、PROVIDERS、marketplace 清单 | 干净目录安装可跑；README 安装段可照做 | ✅ 文档/清单/图标完成；人工安装冒烟待执行 |

### 实现中的偏差（与方案不同，已定稿）

1. **Raster 解码在页面里做**：bridge 截图后用页面自身的 `OffscreenCanvas` 降采样成半格块 u32，避免引第三方图像库。每格上方背景、下方前景，码点 U+2584。
2. **视觉帧不进状态**：一帧 Raster 最大 512×256×12 字节，放 `$.state` 不合适；存在 `hooks/main.tsx` 的模块变量里，热重载后回文本档。
3. **`$` 不跨模块传递**：`claude plugin validate` 禁止把 `$` 当参数传；hub/provider 接收 `engine/ops.ts` 的窄接口，`Ops` 在 hooks 模块里内联构造。
4. **测试的 fake bridge**：`claude plugin test` 无网络/进程，`tests/helpers.ts` 以内存页冒充 bridge，覆盖权限、审计、渲染、降级与重启。
5. **健康检查**：supervisor 每 5s `/health`，连续失败按 250ms×2^n 退避重启，4 次后进错误面板；bridge 空闲 10 分钟自停（健康轮询不算活动）。

每完成一个里程碑：`tsc` + `validate` + 测试 + 本地提交。

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| early access 接口变 | 只用 `engine/adapter.ts`；锁版本校验，大版本变化进保守模式 |
| spawn 无 PTY / stdin 一次性 | bridge 模式：HTTP + token，长驻进程 |
| 页面对快照脚本不友好（shadow DOM、iframe、canvas） | 开放 shadow root 递归；iframe 同源展开、跨源给占位；canvas 走视觉档 |
| 快照脚本被 CSP 拦 | 用 `Runtime.evaluate` 注入函数源码，不经 `<script>` |
| 页面反复重排导致 ref 失效 | ref 绑定后端节点，动作前校验；失效返回 `stale-ref` 并附新快照 |
| 上下文污染 | §3.6 策略 + 硬上限 |
| 端口/令牌泄漏 | 只绑 `127.0.0.1`，随机 32 字节 token，子进程 env 传入，不进命令行 |
| Chrome 多实例占内存 | supervisor 单实例；`/transom close` 立即释放；空闲 10 分钟自动停 |
| Windows 进程树残留 | `taskkill /T /F` + 临时 profile 目录清理（会话结束尽力删） |

## 6. 威胁模型摘要

详见 `docs/SECURITY.md`。要点：bridge 是本机回环上的任意代码执行面（`Runtime.evaluate`），必须校验 token + Origin；页面可伪造一切快照内容，故快照一律当不可信输入处理；`javascript:` 与 `data:` 默认不放行；导航前后都做协议/主机检查；不把页面文本当 Markdown 之外的富文本执行。

## 7. 测试策略

1. **静态**：`tsc --noEmit`；`claude plugin validate`。
2. **bridge 单测**（Node，无引擎）：临时目录起 demo server + 浏览器，断言快照节点、点击后状态、token 拒绝、超时、崩溃恢复。
3. **插件测试**（`claude plugin test`）：mock `$.http.fetch` 与 `spawn`，覆盖权限分级、审计、面板渲染两表面、焦点令牌、降级。
4. **手工冒烟**：会话内 `/transom open http://127.0.0.1:PORT/`，人点、模型点、断网、杀进程。
5. **回归**：每个 fixture 页面类型（表单、列表、shadow DOM、iframe、长文档、canvas）各一条快照断言。

## 8. 成功指标采集

- 闭环时间：动作 → 快照刷新完成（面板打点）。
- `act` 成功率 / `stale-ref` 率 / 误点率（人撤销计数）。
- 空闲 CPU、单帧耗时、快照字节数与 token 数。
- 降级命中率与降级后仍可完成的任务比例。

指标写进审计的 `durationMs` 与 debug 行，不额外开遥测。

## 9. 开放问题（后续）

1. Raster + Client 合成层在真实终端上的坐标误差是否可接受（M3 实测）。
2. provider 是否开放第三方分发：先内部，合同稳定后按 `types/index.d.ts` 合同插件化。
3. 多 provider 并存的焦点与资源配额。
4. 移动 surface 的 Client 支持度。
