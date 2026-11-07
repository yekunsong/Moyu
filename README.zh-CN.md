# Transom（窗侧）

[English](README.md) | **简体中文**

> 在 Claude Code 会话里，为任意应用开一扇可看、可操作、可被模型调用的边窗。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Status](https://img.shields.io/badge/status-early%20access-orange)](#状态)
[![Claude%20Code](https://img.shields.io/badge/Claude%20Code-2.1.319-6f42c1)](https://code.claude.com)

```bash
/plugin install transom --marketplace <owner>/<repo>
```

Transom 把外部应用压成一对接口——`snapshot()` 读结构化状态、`act()` 执行结构化动作——画在会话侧栏里。人和模型共用同一条通道，每个动作都留痕，写操作受权限约束。

窗口从外部搬进终端只是副产品。真正的产出是**结构化、可寻址、可审计的应用状态**。

---

## 目录

- [为什么是 Transom](#为什么是-transom)
- [特性](#特性)
- [状态](#状态)
- [依赖](#依赖)
- [安装](#安装)
- [快速开始](#快速开始)
- [命令](#命令)
- [模型工具](#模型工具)
- [面板操作](#面板操作)
- [配置](#配置)
- [架构](#架构)
- [安全](#安全)
- [引擎调研](#引擎调研)
- [渲染分档](#渲染分档)
- [兼容性与限制](#兼容性与限制)
- [开发](#开发)
- [路线图](#路线图)
- [竞品位置](#竞品位置)
- [开放问题](#开放问题)
- [术语](#术语)
- [参考](#参考)
- [许可](#许可)

## 为什么是 Transom

### 成立的场景

- **终端是唯一入口。** SSH 远程机、容器、tmux。桌面版有 Browser pane 和 DOM/点击工具，但**到不了那些机器**——官方文档明说 SSH 会话没有这些工具。
- **会话比连接活得久。** tmux/screen 会话可跨换机、换网；桌面窗口不行。
- **没有图形环境。** 服务器、CI、无 X 的容器，连浏览器窗口都没有。
- **模型需要的是注册动作，不是截图。** Transom 把 `snapshot`/`act` 注册成本会话的工具：不走 Bash、不带 shell 引号、结果有类型、有可见区预算，任何终端都成立。
- **同屏审查。** 转录和画面在一个视图里：改完立刻看、看错立刻说，不用切窗口。

### 不成立的场景（明确让位）

| 需求 | 该用什么 |
|---|---|
| 本地开发、看排版、视频、精细拖拽、多标签浏览 | 桌面版 Browser pane / 真浏览器 |
| 本地纯写代码、不碰界面 | CLI 本身就够 |
| 像素级保真的验收 | 桌面版 |

**Transom 是远程重度用户的基础设施，不是桌面版的替代品。** 人群小、天花板低（格子分辨率、2–5 fps），但“会话内可见 + 模型可调用”这一截目前仍缺一个 Transom 这样的答案。

## 特性

- **人和模型同一条通道。** 面板与 `mcp__transom__*` 工具进同一个串行动作队列；每条动作记录发起者、目标、策略、结果与耗时。
- **结构化快照，不是截图。** 带稳定 ref 的对象图：role、无障碍名、值、状态、边界。ref 带文档代际，导航后不会悄悄重绑；失效返回 `stale`，不会误点。
- **Provider 框架。** 能力协商、supervisor、白名单、渲染都在 hub；浏览器只是第一个适配器。
- **默认受权限约束。** 只允许 http(s)、主机白名单（localhost 恒允许）、模型写操作逐次确认（或 `once`/`auto`）、只接受精确的 Allow 标签、失败即拒绝。
- **全量审计。** 人与模型动作进同一环形缓冲并持久化到 `$.store`；填写内容脱敏。
- **两档渲染。** 文本档（任何终端）与彩色格档（半格块 Raster，24 位色）；窄面板降级为摘要行。
- **崩溃隔离。** 受监督的本地 bridge 独占无头 Chromium；健康检查、退避重启、空闲自停、关闭时清理进程树。
- **页面内容按不可信数据处理。** 快照带显式横幅；页面字符串在进对话框前剥掉控制字符；点击前做 `elementFromPoint` 命中测试，遮挡会报告 `covered`。

## 状态

v0.1，early access。Claude Code 的 function hooks 接口处于 early access，版本间可能变化。M0–M5 已完成；设计与偏差见 [`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md)。

## 依赖

- Claude Code 2.1.x，启用 function hooks（`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`），运行在**交互式终端**。
- Node.js 20+（推荐 22）。
- 本机已安装 Chrome / Chromium / Edge 之一，或用 `TRANSOM_CHROME` 指定可执行文件。

## 安装

在终端会话里：

```bash
/plugin install transom --marketplace <owner>/<repo>
```

开发时从目录加载：

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 CLAUDE_CODE_NO_FLICKER=1 \
  claude --plugin-dir D:/Study/transom
```

`CLAUDE_CODE_NO_FLICKER=1` 开启全屏布局：面板停靠右侧，**鼠标点击才能到达按钮**。没有它时面板画在提示符上方（inline），鼠标事件到不了；用 `ctrl+x tab` 把键盘交给面板，再用 Tab/Enter。

> 官方文档说 function hooks 只支持交互式终端。实测 2.1.319 的 `claude -p` 也会加载插件工具（`--allowedTools mcp__transom__…` 可用于无头验证），但这是 early access 行为，不保证后续版本。

## 快速开始

```text
/transom demo          # 启动本地演示页并在面板中打开
```

在面板里点击 **Increase count**。然后对模型说：

> 先调用 `mcp__transom__browser_snapshot`，再用 `browser_act` 点击名为 "Increase count" 的按钮，然后重新快照并报告计数。

模型的写操作会先确认。`/transom audit` 会显示两条记录，分别归属 `person` 与 `model`。

## 命令

| 命令 | 作用 |
|---|---|
| `/transom` | 打开面板 |
| `/transom open <url>` | 打开面板并导航（默认只允许 localhost/127.0.0.1 与配置的主机） |
| `/transom demo` | 启动本地演示页（计数、表单、列表、canvas、shadow DOM、iframe、长滚动）并打开 |
| `/transom audit` | 最近 20 条审计 |
| `/transom close` | 关闭面板并停止浏览器 |

## 模型工具

| 工具 | 权限 | 用途 |
|---|---|---|
| `mcp__transom__browser_open` | 写（导航） | 打开面板并导航；白名单外主机需确认 |
| `mcp__transom__browser_snapshot` | 读 | 结构化快照：URL、标题、地标、带 ref 的节点 |
| `mcp__transom__browser_act` | 读/写 | `click`、`fill`、`select`、`press`、`scroll`、`hover`、`focus`、`navigate`、`back`、`forward`、`reload` |
| `mcp__transom__browser_screenshot` | 读 | 截取可见区 PNG，用于视觉检查 |
| `mcp__transom__browser_audit` | 读 | 最近动作及其发起者与结果 |

快照默认返回可见区；`scope: "document"` 请求整页。两者都受 `snapshotMaxChars` 限制。ref 在下一次快照或导航前有效。

## 面板操作

- **鼠标**需要全屏布局（`CLAUDE_CODE_NO_FLICKER=1`）；inline 面板只支持键盘焦点。
- 点击一行立即执行（人看得到页面）。模型写操作按 `writePolicy` 确认。
- 文本框与下拉框可直接在行内编辑：输入后回车，或选择选项，不再弹窗。
- `visual` 切彩色格档；再按一次回文本档。
- 点击底部键盘条后，按键转发给页面；Esc 交还提示符。
- 窄于 48 列显示降级提示。

## 配置

`plugin.json` → `userConfig`：

| 选项 | 默认值 | 含义 |
|---|---|---|
| `allowedHosts` | `localhost,127.0.0.1` | 逗号分隔的主机；localhost 恒允许。支持 `*.example.org` 通配。 |
| `writePolicy` | `confirm` | `confirm`（每次写）、`once`（会话内首次写；提交类动作仍确认）、`auto` |
| `snapshotMaxChars` | `12000` | 交给模型的快照字符硬上限 |

## 架构

依赖向内：只有 hooks 模块触碰引擎 API。

```text
hooks/main.tsx          注册、命令、面板、Ops 字面量
hooks/tools.ts          五个模型工具与输出投影
engine/ops.ts           $ 的窄接口
engine/adapter.ts       fetchJson / ask / store 包装
engine/supervisor.ts    bridge 进程、握手、健康、退避、停止
hub/hub.ts              串行动作队列、视图模型、审计接线
hub/permissions.ts      协议/主机白名单、动作分级
hub/audit.ts            环形缓冲 + $.store 持久化
hub/negotiate.ts        能力协商与降级
providers/browser/      provider 合同、HTTP 客户端、面板行/键盘
bridge/                 回环 HTTP + CDP + 注入页面的 agent
demo/                   演示应用与静态服务器
tests/                  插件测试、supervisor 单测、bridge E2E
```

### Provider 合同

```ts
type Provider = {
  readonly meta: {
    id: string
    label: string
    capabilities: {
      pointer: boolean; keys: boolean; scroll: boolean; images: boolean
      text: boolean; minCols: number; minRows: number
    }
    allowSchemes: string[]
    defaultWidth: number
  }
  start(): Promise<void>
  stop(): Promise<void>
  health(): Promise<{ ok: boolean; url?: string; title?: string; error?: string | null }>
  snapshot(request: { scope: 'viewport' | 'document'; maxChars: number; cols: number; rows: number }): Promise<Snapshot>
  act(action: Action, context: { actor: 'person' | 'model' }): Promise<ActResult>
  screenshot?(cols: number, rows: number): Promise<{ pngBase64: string }>
  raster?(cols: number, rows: number): Promise<{ cells: string; columns: number; rows: number }>
}
```

ref 必须来自应用自身的对象身份，不能是坐标或下标。ref 失效时 provider 必须报告 `stale`，绝不能悄悄操作另一个元素。详见 [`docs/PROVIDERS.md`](docs/PROVIDERS.md)。

### 关键机制

- **能力协商：** 窄面板、无指针/键盘支持的终端降级为文本档或摘要行。
- **Supervisor：** 每个 provider 一个 bridge；握手、健康轮询、指数退避、空闲自停、进程树清理。
- **共用队列：** 权限判定、确认、执行在一个临界区；页面不会在“允许”与动作之间被换掉。
- **上下文策略：** 可见区 + 地标摘要；整页需显式请求且始终设上限。
- **失败即拒绝：** 只有精确的 `Allow` 标签会批准；自由文本或关闭对话框都算拒绝。

## 安全

见 [`docs/SECURITY.md`](docs/SECURITY.md)。简述：bridge 是回环 HTTP 服务，每次启动生成随机 bearer token 并拒绝浏览器 `Origin`；Chrome 使用一次性 profile；导航仅 http(s) 且受主机白名单约束；密码值遮蔽；页面文本是不可信数据，不是指令；所有动作入审计。

已知非目标：模型点击链接可能以副作用的方式跳到白名单外主机。`confirm`/`once` 策略下这次点击本身要确认；`auto` 放弃这层保护。

## 引擎调研

于 Claude Code 2.1.319、本地交互式终端实测。

### 可用

| 能力 | API |
|---|---|
| 侧栏面板 | `$.ui.open({ id, title, columns })`；被请求后 ≥110 列停靠（未被请求需 144 列） |
| 渲染 | `Client` 树、`Raster`（每格 u32 `[码点, 前景, 背景]`）、`Image`、`Svg`、`Markdown`、`Code` |
| 帧钟 | `surface.every(ms, fn)`；重绘 ≤10/s（终端面板显示中 30/s）；`$.ui.blit` 实收约 60/s |
| 指针 | `surface.onPointer` 的 `down/move/up/enter/leave`；kitty、Ghostty、iTerm2、WezTerm、foot 有亚格 `fine.x/y` |
| 键盘 | 点击夺焦后 `surface.onKey`；Esc 必还 |
| 尺寸 | `Client` 的宽高支持百分比；`surface.columns/rows` 为实测格数 |
| 多表面 | 同一棵树按 `e.surface` 区分 terminal/desktop/vscode/mobile |
| 外部进程 | `$.process.spawn`（stdout 流、stdin 一次性）、`$.process.run` |
| 网络 / 文件 | `$.http.fetch`、`$.mcp.connect`；`$.fs` 单次读 ≤4 MiB |
| 模型接口 | `$.tool.register`、`$.session.append`、`$.ui.ask` |
| 状态 | `$.state`（会话）/ `$.store`（跨会话），带类型契约 |

### 硬约束

1. **`spawn` 的 stdin 一次性，没有 PTY。** 交互程序必须自带控制端口（CDP / JSON-RPC / socket）或改成单次进程。
2. **`Client` 不能嵌 `Raster`/`Image`。** 高帧率与指针输入需要合成层：Raster 铺像素，极薄 Client 收指针。
3. 连续三次 `setState` 且无事件会触发渲染循环检测并卸载实例。
4. 单树上限 2 万节点 / 10 万字符；Raster 单块 512×256。
5. 终端没有 key-up；tmux 不透传亚格 `fine` 坐标。
6. 鼠标仅在开屏全屏布局（`CLAUDE_CODE_NO_FLICKER=1`）下可用。
7. 需要 `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`。官方仅支持交互式；2.1.319 的 `-p` 也能加载工具（见[安装](#安装)）。
8. early access：接口会随版本变化。

## 渲染分档

| 档 | 内容 | 成本 | 状态 |
|---|---|---|---|
| 文本 | 文字、链接、表单结构，带色 | 低 | 已实现 |
| 彩色格 | Raster 降采样、24 位色、按行可点 | 中 | 已实现（`visual`） |
| 图像 | 终端图像协议，仅部分终端 | 高 | 未实现 |

颜色是真的 24 位前景/背景，不是黑白。但格子终究是“像”不是“是”：小字号会糊，圆角阴影会消失。

## 兼容性与限制

- **终端：** kitty、Ghostty、iTerm2、WezTerm、foot 全功能；Windows Terminal、GNOME 降级；tmux 失去亚格精度。
- **仅交互式：** 桌面版、移动端、无头会话不画面板。
- **仅无头 Chrome：** 默认无登录态、无扩展、无音频、无多标签。
- **Canvas 无语义：** canvas 内容以图像参与，不是节点。
- **Raster 为手动刷新：** `visual` 按需重绘；尚无脏区连续推流。

## 开发

```bash
npm test          # 类型检查 + 插件校验 + 插件测试 + bridge E2E
npm run typecheck
npm run validate
npm run test:plugin
npm run test:bridge
```

- `tests/bridge/bridge.test.mjs` 启动演示服务器与真实无头 Chrome：快照、点击、填写、shadow DOM、iframe、Raster、失效 ref、遮挡目标、密码遮蔽。
- `tests/*.test.ts` 在引擎测试套件里用内存 fake bridge：权限、审计、渲染、降级、重启竞态。
- 提交信息遵循 Conventional Commits（`feat:`、`fix:`、`docs:`、`chore:`），英文、祈使句。见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 路线图

- **M0–M5（已完成）：** 探针、provider 合同 + bridge、人机共用通道、彩色格档、降级与恢复、文档与打包。
- **下一步：** 脏区 Raster 推流与图像档；`once` 策略端到端测试；第二个 provider（Minecraft 或 LINE 网关）压合同。
- **更远：** 通过 `types` 合同分发第三方 provider；多 provider 焦点与资源配额；移动表面。

## 竞品位置

Transom 不是第一个会话内浏览器。[`zenbu-labs/terminal-browser`](https://github.com/zenbu-labs/terminal-browser)（MIT，约 4.5k★）已通过 `agent-browser` CLI 提供面板 + 模型动作；Claude Code 桌面版也内建 DOM 级 Browser pane。Transom 瞄准的是更窄的空位：

1. **Provider 无关的框架** —— 任何应用的能力协商、supervisor、白名单与审计，不只浏览器。
2. **注册工具而非 shell CLI** —— 类型化输入输出、无 Bash 权限弹窗、可见区 token 预算。
3. **人机同一条队列** —— 同一焦点、同一审计、同一个 `act()`。
4. **远端与 tmux 一等公民** —— 文本档在任何终端可读，不依赖 kitty graphics。

逐条核对见 [`docs/COMPETITORS.md`](docs/COMPETITORS.md)。

## 开放问题

1. Transom 面板与 tmux 分屏的边界在哪里？
2. 对无官方 API 的目标（LINE/微信），重连与封号风险是否值得第一波做？
3. 确认粒度：逐次太吵、全放行太险，按 provider 分级是否够？
4. Raster + Client 合成层的帧率与坐标误差能否接受？
5. provider 是否要成为可第三方分发的插件，还是在合同稳定前留在核心？

## 术语

- **Mod / function hooks：** 在 Claude Code 内运行的插件形态，可绘制会话 UI、接收输入、调用宿主能力。
- **Provider：** 实现 `snapshot`/`act` 的外部应用适配器。
- **快照：** 应用状态的结构化序列化，供模型与渲染共用。
- **Ref：** 快照作用域内的节点地址；导航或新快照后失效。

## 参考

- 引擎类型与长文档：随 skill 生成在 `.../bundled-skills/<version>/plugin-authoring/`。
- 骨架与手感参考：[manfye/cc-dino](https://github.com/manfye/cc-dino)（点击夺焦、`$.store`、33ms 帧、空间不足提示）、[tomas-schmieder/clawd-run](https://github.com/tomas-schmieder/clawd-run)（`prompt.edit` 空输入框判定、半格位图、类型契约、`NOTICE` 归属写法）。
- 生态：[claude-mods-starter-kit](https://github.com/promptadvisers/claude-mods-starter-kit)（MIT）、[awesome-claude-code-mods](https://github.com/karanb192/awesome-claude-code-mods)、[mods.aidojo.si](https://mods.aidojo.si/)。

## 许可

[MIT](LICENSE)。

引擎与多数骨架为宽松许可（MIT/BSD-3）。若未来引入 Doom 一类 GPL-2.0 引擎，需单独目录放置并声明。
