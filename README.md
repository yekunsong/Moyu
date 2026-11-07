# Transom（窗侧）

> 在 Claude Code 会话里，为任意应用开一扇可看、可操作、可被模型调用的边窗。

状态：调研完成，实现中（方案见 `docs/IMPLEMENTATION-PLAN.md`）
日期：2026-11-07
目标平台：Claude Code CLI（function hooks / Mods，early access）
工作目录：`D:/Study/transom`

---

## 1. 一句话

把终端外部应用压成一对接口——`snapshot()` 读状态、`act()` 执行动作——画在会话侧栏里，人和模型共用同一条通道，动作留痕、受权限约束。

窗口从外部搬到会话里只是副产品。真正的产出是**结构化、可寻址、可审计的应用状态**。

## 2. 为什么是它

### 2.1 成立的场景

- **终端是唯一入口**：SSH 到远程机、容器里、tmux 里。桌面版有 Browser pane 和它的 DOM/点击工具，但**到不了那台机器**——官方文档明说 SSH 会话里模型没有这些工具（本机已有的 `ssh -p 8027` 就是这种环境）。
- **断线不断活**：tmux/screen 会话常驻，换机器、换网络、从手机接回，还是那一屏。桌面上关掉就没了。
- **无图形环境**：服务器、CI、无 X 容器，连浏览器窗口都不存在。
- **模型需要能动的东西，且要是注册工具**：桌面版靠它自己的内置工具，只在桌面进程里成立；Transom 给的是注册进本会话的 `snapshot`/`act` 工具和结构化对象图——不走 Bash、不带 shell 引号、结果有类型、有可见区预算，任何终端都成立。
- **同屏审查**：改完立刻看、看错立刻说，转录和画面同会话，复盘不用切窗口。

### 2.2 不成立的场景（明确让位）

| 需求 | 该用什么 |
|---|---|
| 本地开发、要看排版、视频、精细拖拽、多标签浏览 | 桌面版 Browser pane / 真浏览器 |
| 本地纯写代码、不碰界面 | CLI 本身就够 |
| 需要像素级保真的验收 | 桌面版 |

**结论：Transom 是远程重度用户的基础设施，不是桌面版的替代品。**人群小、天花板低（格子分辨率、2–5 fps），但"会话内可见 + 模型可调用"这一截目前是空的。

## 3. 定位与边界

**做**：provider 框架、能力协商、焦点仲裁、进程监督、权限与白名单、文本/彩色格/图像三档渲染、审计留痕。

**不做**：终端模拟器、多路复用器（交给 tmux）、通用截屏点按（用协议寻址）、像素级渲染、脱离 Claude Code 的独立宿主。

## 4. 竞品与先例

### 4.1 会话内面板

| 项目 | 说明 | 缺口 |
|---|---|---|
| **[zenbu-labs/terminal-browser](https://github.com/zenbu-labs/terminal-browser)**（MIT，4.5k★） | Chromium 离屏渲染到 kitty graphics，作为 function-hooks 面板；`/browser` 命令；可选 `open`/`close` 工具，动作走 `agent-browser` CLI（文本 a11y 快照 + `@e1` 引用） | 动作走 Bash CLI 而非注册工具；面板依赖 kitty graphics + unicode 占位，tmux 下失效且坐标报错；只有浏览器，无 provider 框架、无人与模型共用队列、无审计 |
| [sandipchitale/browser-pane](https://github.com/sandipchitale/browser-pane)（MIT） | 共享浏览器窗口，各 mod 加标签页，本地 HTTP + 会话 token | README 明确不含 DOM 读取与点击驱动 |
| [pinkpixel-dev/claude-workspace](https://github.com/pinkpixel-dev/claude-workspace) | 工作区面板：浏览编辑文件、撤销 Claude 改动 | 限文件域 |
| [kesavreddy-commits/repoviewer](https://github.com/kesavreddy-commits/repoviewer) / [timmetim/cli-mod](https://github.com/timmetim/cli-mod) | 仓库浏览 / 文件浏览器 + diff | 限文件域 |
| [hwanyong/pane-grid](https://github.com/hwanyong/pane-grid) | 把 pane 切成 tmux 式网格 | 只是分屏 |
| [reporails/arcade](https://github.com/reporails/arcade)（MIT） | 每个游戏一个插件 + marketplace 清单；Doom 走本地 socket | 无共享框架层，无模型接口 |

### 4.2 模型可驱动浏览器（能动，窗口在外）

[open-claude-in-chrome](https://github.com/noemica-io/open-claude-in-chrome)（274★）、[safari-mcp](https://github.com/achiya-automation/safari-mcp)（237★）、[cdpilot](https://github.com/mehmetnadir/cdpilot)、[browser-debugger-cli](https://github.com/szymdzum/browser-debugger-cli)（184★），以及 `chrome-devtools-mcp`、`playwright` MCP。

**共性缺口**：窗口和会话分离，人看不到模型在点什么。桌面版内建的 Browser pane 已经解决了本地场景——模型能读 DOM、点击、填表——但它不在 CLI 里、到不了 SSH 远端，也没有 provider 抽象。

### 4.3 其他接入先例

- [pisanvs/mc-cc](https://github.com/pisanvs/mc-cc)：方向和我们要的相反——在 Minecraft 里跟 Claude 对话
- [claude-image-view](https://github.com/jarrodwatts/claude-image-view)：提示符上方显示图片
- [prismantis](https://github.com/NahumLitvin/prismantis)（316★）：表格、代码、图表的富渲染
- [prompt-rail](https://github.com/oikon48/prompt-rail)（59★）：历史提示条

**结论：位置要收窄。** 2026-07 起 [terminal-browser](https://github.com/zenbu-labs/terminal-browser) 已经证明了"会话内浏览器 + 模型动作"，2026 年的桌面版也内建了 DOM 级 Browser pane。Transom 的空位不在"会话里有个浏览器"，而在：

1. **provider 无关**：浏览器只是第一个适配器，合同按能力协商写；下一个可以是 Minecraft、LINE。
2. **注册工具而非 shell CLI**：类型化输入输出、无 Bash 权限弹窗、可见区 token 预算。
3. **人机同一条队列**：同一把焦点令牌、同一份审计、同一个 `act()`。
4. **远端与 tmux 是一等公民**：不依赖 kitty graphics，文本档在任何终端可读。

## 5. 引擎能力调研（本机实测，Claude Code 2.1.319）

引擎指 Claude Code 内置的 function hooks / Mods 运行时，官方 early access。

### 5.1 可用

| 能力 | API |
|---|---|
| 侧栏面板 | `$.ui.open({ id, title, columns })`，`flexGrow` 跟随宽度；未请求面板从 144 列起（`columns` 可降到 110） |
| 渲染 | `Client` 文本树、`Raster`（每格 u32 `[码点, 前景, 背景]`）、`Image`、`Svg`、`Markdown`、`Code` |
| 帧钟 | `surface.every(ms, fn)`；重绘 10/s，已显示区域 30/s；`ui.blit` 120/s 实收约 60/s |
| 指针 | `surface.onPointer` 收 `down/move/up/enter/leave`，kitty/Ghostty/iTerm2/WezTerm/foot 有亚格 `fine.x/y`；按住期间越界仍收，转录不抢选中 |
| 键盘 | `surface.onKey`，点击夺焦后到达，Esc 必还 |
| 尺寸 | `Client` 的 `width`/`height` 支持百分比；`surface.columns/rows` 给实尺寸，resize 后重调 |
| 多表面 | 同一树按 `e.surface` 分 terminal/desktop/vscode/mobile |
| 外部进程 | `$.process.spawn`（stdout 流）、`$.process.run`、`$.process.get` |
| 网络 | `$.http.fetch`，`$.mcp.connect` |
| 文件 | `$.fs`，单次读 ≤4 MiB |
| 模型接口 | `$.tool.register` 注册工具；`$.session.append`；`$.ui.ask` |
| 存档 | `$.state`（会话内）/`$.store`（跨会话），带类型契约校验 |

### 5.2 硬约束

1. **`spawn` 的 stdin 一次性**（写字符串后关闭），没有 PTY。交互程序必须开控制端口（CDP / JSON-RPC / socket）或改成单次进程。
2. **Client 不能嵌 Raster/Image**：要高帧率用 Raster，要鼠标用 Client，两者冲突，需"Raster 铺画面 + 极薄 Client 收指针"的合成层。
3. `setState` 连续三次无事件会触发渲染循环检测并卸载实例。
4. 单树上限 2 万节点、10 万字符；Raster 单块 512×256。
5. 终端无 key-up，长按只能帧计数；tmux 不透传 `fine`。
6. 鼠标仅全屏布局（`CLAUDE_CODE_NO_FLICKER=1`）可用；非全屏只能键盘开在提示符上方。
7. 需要 `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`，仅交互式终端，`-p` / 桌面 / 移动端不可用。
8. early access，接口会变。

## 6. 可行性分档

| 档 | 内容 | 成本 | 采用 |
|---|---|---|---|
| 文本 | 文字、链接、表单结构，带色 | 低 | M1 |
| 彩色格 | Raster 降采样 + 24 位色，可按坐标点 | 中，单帧 150–400ms | M2 |
| 真图像 | 终端图像协议，仅部分终端 | 高 | M3 可选 |

颜色是真的 24 位前景/背景，不是黑白。但格子终究是"像"不是"是"：小字号会糊，圆角阴影没有。

## 7. 架构

单向依赖，只有最内层碰引擎。

```
transom/
  hub/                     注册表、能力协商、焦点令牌、supervisor、权限
  providers/<name>/        每应用一个适配器
    contract.ts            capabilities: { pointer, keys, scroll, images, minCols, minRows }
    transport.ts           CDP / JSON-RPC / socket / stdout → { snapshot(), act(), frames() }
    render.tsx             快照 → 格子或 Image
    meta.ts                尺寸门槛、降级、启动/停止/探活
  engine/                  帧钟、输入合流、布局裁切、存档、降级
  apps/<id>/               纯逻辑
```

### 7.1 provider 合同

```ts
type Provider = {
  capabilities: { pointer: boolean; keys: boolean; scroll: boolean; images: boolean;
                  minCols: number; minRows: number };
  start(): Promise<void>;
  stop(): Promise<void>;
  snapshot(): Promise<Snapshot>;        // 结构化，进上下文
  act(a: Action): Promise<void>;        // 结构化寻址
  frames?(): AsyncIterable<Frame>;      // 视觉档
};
```

### 7.2 关键机制

- **能力协商**：tmux/窄终端自动降键盘与文本档；低于 `minCols` 画摘要行
- **焦点令牌**：全局唯一持有者；`prompt.edit` 只在输入框空时取，Esc 必还，`turn.complete` 释放不卸载
- **supervisor 独占进程**：起、探活、限并发、退出时杀进程树、重连退避
- **双向**：同一合同映射成 `$.tool.register` 工具（`browser.click`、`mc.move`），人与模型动作进同一队列
- **上下文策略**：快照默认只出可见区 + 结构摘要；整页按需拉取，避免烧 token
- **安全**：每 provider 声明域名/路径白名单；凭证走 `$.session.authorize` 拿句柄；写操作默认要确认，只读工具可进白名单

## 8. 非功能要求

- 渲染不掉帧：逻辑固定步长，渲染可变帧，掉帧不改物理
- 空闲停钟：失焦、不可见、`turn.complete` 停 `every`
- 崩溃可恢复：provider 崩溃不拖垮会话，面板留错误态 + 重连
- 审计：每个 `act()` 记动作、来源（人/模型）、结果
- 兼容矩阵：kitty、Ghostty、iTerm2、WezTerm、foot 全功能；Windows Terminal、GNOME 降级；tmux 无 `fine`

## 9. 成功指标

- 远程机上一次改完立刻看、立刻改的闭环时间
- 模型 `act()` 成功率与误点率
- 空闲 CPU 与单帧耗时
- 降级路径命中率（多少会话落到文本档仍可用）

## 10. 路线图

- **M0 探针**：最小 mod，验证 `ui.open` + Client 指针 + `spawn` 无 PTY 的现实影响
- **M1 浏览器文本档**：无头 Chrome + CDP，`snapshot()` 出可读化 DOM，`act()` 点/填/脚本；全键盘
- **M2 混合档**：可见区缩略图 + 文本并排，只重画变化区
- **M3 第二、三个 provider**：Minecraft（mineflayer + 本地 bridge，俯视 ASCII）、微信（wechaty 类网关或 TUI 客户端，历史读本地 sqlite）
- **M4 抽象收敛**：三个能力差异极大的 provider 压出合同，再谈覆盖
- **M5 发布**：marketplace + README + `install` 命令（插件不能自己写 `statusLine`，同理需用户执行一次）

## 11. 风险

| 风险 | 应对 |
|---|---|
| early access 接口变更 | 引擎能力集中在 `engine/` 一层，便于替换 |
| 无 PTY | 只接受有协议的 provider；TUI-only 应用降级为"起一次进程" |
| 终端差异 | 能力协商 + 显式兼容矩阵，不承诺全终端 |
| 性能塌陷 | 视觉档限 2–5 fps，纯文本优先 |
| 攻击面扩大 | 白名单 + 确认 + 审计；接入即授权 |
| 页面提示注入（快照文本骗模型点外链/填表） | 快照当不可信输入；导航永远校验协议/主机；写动作默认确认；审计可回看 |
| 厂商竞争：terminal-browser 已占浏览器场景 | 不与其拼渲染；押 provider 框架、注册工具、远端与审计 |
| 上下文污染 | 快照裁剪策略，默认只给可见区 |

## 12. 开放问题

1. 面板与 tmux 分屏的边界：什么交给 tmux，什么必须由 Transom 管？
2. 微信这类无官方 API 的目标，掉线重连与封号风险是否值得第一波做？
3. 模型动作的确认粒度：逐次确认太吵，全放行太险，按 provider 分级是否够？
4. Raster + Client 合成层的实际帧率与坐标误差能否接受？
5. 是否要把 provider 做成可被第三方分发的插件，还是先锁在核心？

## 13. 术语

- **Mod / function hooks**：在 Claude Code 进程内运行的插件形态，可绘制会话 UI、响应输入、调用宿主能力
- **Provider**：一个外部应用的适配器，实现 `snapshot`/`act`
- **快照**：应用状态的结构化序列化，供模型与渲染共用
- **焦点令牌**：唯一键盘持有权，点击夺得、Esc 交还

## 14. 参考

- 引擎类型与参考文档：`C:\Users\27581\AppData\Local\Temp\claude\bundled-skills\<ver>\plugin-authoring\`（随 skill 加载生成）
- 骨架与手感参考：[manfye/cc-dino](https://github.com/manfye/cc-dino)（点击夺焦、`$.store`、33ms 帧、空间不足提示）、[tomas-schmieder/clawd-run](https://github.com/tomas-schmieder/clawd-run)（`prompt.edit` 空输入框判定、半格位图、类型契约、`NOTICE` 归属写法）
- 生态：[promptadvisers/claude-mods-starter-kit](https://github.com/promptadvisers/claude-mods-starter-kit)（MIT，模板与构建校验）、[awesome-claude-code-mods](https://github.com/karanb192/awesome-claude-code-mods)
- 细分目录：[mods.aidojo.si](https://mods.aidojo.si/)

## 15. 许可备注

引擎与多数骨架宽松（MIT / BSD-3）。若引入 Doom 一类 GPL-2.0 引擎，需分区放置并单独声明。
