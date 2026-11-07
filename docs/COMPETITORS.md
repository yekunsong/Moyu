# 竞品核对数据

核对日期：2026-11-07。方法：GitHub API 取 star/license，WebFetch 读 README，官方文档核对功能。用于校正 README 第 4 节，不重复定位论证（见 README §4 与方案 §2）。

## 结论

1. **最接近的三家**：zenbu-labs/terminal-browser（面板 + 模型动作，直接竞品）、Claude Code 桌面版 Browser pane（DOM 级工具，本地限定）、vercel-labs/agent-browser（正是我们想要的 a11y 快照 + `@e1` 引用协议，但没有画面）。
2. **README 原结论"组合没人做"已过时**。空位改为：provider 框架、注册工具而非 CLI、人机同队列与审计、远端/tmux 可用。
3. 面板类竞品普遍极小（0–6★，1–33 次提交），除了 terminal-browser；"两边都成熟"高估了面板一半。

## 一、会话内面板

| 仓库 | ★ / 许可 | 实际能力 | 缺口 |
|---|---|---|---|
| zenbu-labs/terminal-browser | 4.5k / MIT | Chromium 离屏渲染到 kitty graphics，function-hooks 面板，`/browser`，可选 `open`/`close` 工具；动作走 `agent-browser` CLI，文本 a11y 快照 + ref | 动作是 Bash CLI 不是注册工具；kitty graphics 依赖，tmux 失效、坐标报错；浏览器专用，无框架/审计/共用队列 |
| sandipchitale/browser-pane | 0 / MIT | 共享浏览器窗口，各 mod 加标签页，localhost + 会话 token | README 明确无 DOM 读取与点击 |
| pinkpixel-dev/claude-workspace | 3 / Apache-2.0 | 文件浏览编辑、撤销 Claude 改动、用量、git/GitHub | 文件域；README 未写许可 |
| kesavreddy-commits/repoviewer | 0 / MIT | 仓库浏览/编辑面板，注册一个只读 `show_file` 工具 | 模型只收到一行确认，读不到面板状态 |
| timmetim/cli-mod | 0 / 无 | 文件浏览器、编辑器、diff | 无模型接口 |
| hwanyong/pane-grid | 0 / MIT | 把 pane 切成 tmux 式网格 | 只是分屏，FAQ 明说无模型调用 |
| reporails/arcade | 6 / MIT | 游戏插件（扫雷、打砖块、Doom），marketplace 清单 | 游戏状态留在本地，不挂工具 |
| Unayung/cc-mods-enil | 18 / MIT | 面板里的 LINE 客户端 | 仅 `draft` 工具，模型读不到消息 |

## 二、模型可驱动浏览器（窗口在外 / 无画面）

| 仓库 | ★ / 许可 | 说明 |
|---|---|---|
| open-claude-in-chrome | 274 / MIT | 洁净室 Chrome 扩展克隆，21 个 MCP 工具，原生消息通信，独立窗口 |
| safari-mcp | 237 / MIT | macOS，AppleScript + Safari 扩展，98 个工具 |
| browser-debugger-cli | 184 / MIT | 给 agent 的 CDP shell 命令，常驻后台 Chrome |
| cdpilot | 33 / MIT | 70+ CDP CLI 命令 + MCP |
| chrome-devtools-mcp | 54.9k / Apache-2.0 | 官方 MCP 服务器 |
| playwright-mcp | 39.3k / Apache-2.0 | 微软 MCP 服务器 |
| vercel-labs/agent-browser | 46.4k / Apache-2.0 | CLI，`snapshot` 返回 a11y 文本 + `@e1` 引用；Transom 快照协议的参照物，无画面 |

## 三、其他

| 仓库 | ★ | 说明 |
|---|---|---|
| iamumeransari/claude-show-your-work | 298 | 行内图片/视频 + 一次性 Chrome `show_html`；展示为主 |
| hamzafer/claude-code-mods | 449 | browser-lanes（Playwright 归属清理）、md-preview；无浏览器面板 |
| data-goblin/claude-code-filetree | 388 | 只有面板 |
| prismantis | 317 | 表格/代码/图表富渲染 |
| claude-image-view | 278 | 提示符上方显示图片 |
| pisanvs/mc-cc | 2 | 在 Minecraft 里对话，方向相反 |
| ruvnet/ruflo `plugins/ruflo-browser` | — | Playwright MCP 工具 + a11y/DOM 快照产物，无面板 |

## 四、Claude Code 自身

桌面版内建 **Browser pane / 应用预览**：从 `.claude/launch.json` 起 dev server，在对话旁打开；模型能截图、读 DOM、点击、填表，编辑后自动验证。限制：仅桌面版，不在 CLI；官方文档明说 SSH 会话里模型没有这些工具。

## 五、对 README 的具体修正

- §2.1 第一条：原写"桌面版到不了"，改为"桌面版的 pane 工具到不了 SSH 远端"。
- §2.1 第四条：原写模型"盲猜截图"，改为"桌面内置工具只在桌面成立；Transom 给注册工具"。
- §4 结论：由"组合没人做"改为四条收窄后的空位。
- §4.1 补 terminal-browser 一行；repoviewer 的"只读工具"、claude-workspace 的 Apache-2.0 补齐。
- §11 增加厂商竞争与页面提示注入两项。
