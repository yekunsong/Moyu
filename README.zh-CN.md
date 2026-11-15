# moyu 摸鱼

[English](README.md) | **简体中文**

> 在 Claude Code 会话里假装工作的一个小说阅读器。

[![CI](https://github.com/yekunsong/Moyu/actions/workflows/ci.yml/badge.svg)](https://github.com/yekunsong/Moyu/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-2.1.x-6f42c1)](https://code.claude.com)
[![Status](https://img.shields.io/badge/status-early%20access-orange)](#状态)

moyu 把 Claude Code 会话的一侧变成一页正文。它借用**你自己**的主题、长得像命令输出，一个键就能收起；模型读同一页，并用同样的样式留下批注。

没有浏览器、没有守护进程、没有网络：一个文本目录，一块窗格。

```text
novels/01-night-ferry.txt · 37%
第一章 夜航

渡口的灯在雾里只剩一团黄。阿桂把缆绳在手心绕了两圈，
船身便轻轻贴住石阶。

他数着岸上的脚步声，一遍又一遍。

· AI 雾、玻璃和潮汐——三样让人看不清的东西。
空格/j/k 翻页 · n/p 章节 · a 引用 · q 隐藏
q 隐藏
```

---

## 目录

- [为什么](#为什么)
- [功能](#功能)
- [环境要求](#环境要求)
- [安装](#安装)
- [快速开始](#快速开始)
- [命令](#命令)
- [键盘](#键盘)
- [模型工具](#模型工具)
- [配置](#配置)
- [书库](#书库)
- [架构](#架构)
- [安全与隐私](#安全与隐私)
- [兼容性与限制](#兼容性与限制)
- [状态](#状态)
- [路线图](#路线图)
- [开发](#开发)
- [常见问题](#常见问题)
- [参与贡献](#参与贡献)
- [许可证](#许可证)

## 为什么

上班看书，最好看起来像在工作。浏览器标签页或阅读器切走一个 alt-tab 就会露馅；会话里一块 `less` 形状的窗格不会。

moyu 围绕三个小想法：

1. **伪装。** 默认完全不设置主题。正文继承会话自己的文字颜色，边框信息用 dim，标题没有框线。它读起来就是又一段输出。
2. **老板键。** `q` 立刻收起窗格；一句空的 `/moyu` 回到同一段，没有打开的书记则回到上一本。
3. **共享通道。** 模型通过注册工具读同一页并加批注；选中一段按 `a` 把它引用进 prompt 再提问。

它刻意很小：文本进，文本出，进度落盘，别的都不做。

## 功能

- **纯文本页面。** 段落与章节标题，按视口翻页，dim 的路径和百分比抬头。没有阅读器外壳。
- **继承配色。** `theme: "auto"`（默认）从不调用 `$.theme.set`，窗格跟随你自己的终端与 Claude Code 主题。`mono`、`paper`、`ink` 是需要显式选择的预设。
- **老板键。** `q`、Escape、`/moyu`（无参）或 `/moyu hide`。打开会请求焦点，Escape 直接关闭，窗格背景透明。
- **续读。** 章节与偏移按文件存在 `moyu.progress.<hash>`；空 `/moyu` 会按保存处重开上一本，收起不会丢位置。
- **书库守卫。** 只放行解析后根目录内的 `.txt`、`.md`、`.text` 普通文件；软链接按真实路径判断。
- **目录书架。** 打开目录会列出可读文件；空窗格会列出最近阅读。
- **共享批注。** `mcp__moyu__annotate` 给段落 ref 加注；批注以 `· AI` 开头、同色斜体，紧跟在锚点段之后。
- **ask about ¶。** 点选一段后按 `a` 或脚注按钮，经 `$.prompt.fill` 引用进 prompt，不自动提交。
- **自动隐藏。** `autoHideSeconds` 在空闲后收起；任何按键都会重新计时。
- **有审计。** 人和模型共用一条串行队列和一份审计环。

## 环境要求

- Claude Code 2.1.x，开启功能钩子（`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`），在**交互式终端**里。
- Node.js 22+。
- 一个存放 UTF-8 `.txt`、`.md` 或 `.text` 的书库目录。

不需要 Chrome、不需要额外进程、不需要自己的 API key。

## 安装

在会话里：

```text
/plugin install moyu --marketplace yekunsong/Moyu
```

从检出目录开发：

```bash
git clone https://github.com/yekunsong/Moyu.git
cd Moyu
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 CLAUDE_CODE_NO_FLICKER=1 \
  claude --plugin-dir "$PWD"
```

`CLAUDE_CODE_NO_FLICKER=1` 打开全屏布局：窗格停靠右侧，鼠标可达。内联窗格只有键盘——`ctrl+x tab` 给它键盘，Escape 归还。

## 快速开始

```bash
mkdir -p novels
cp fixtures/novel/* novels/
```

```text
/moyu 01-night-ferry.txt
```

用 `↓`/`↑`、`space`/`b`、`j`/`k` 或鼠标阅读。点一段选中，按 `a` 放进 prompt。`q` 收起，`/moyu` 回到同一页。

让模型：

> 调用 `mcp__moyu__read`，再对第二段调用 `mcp__moyu__annotate` 写一行注，然后重新读这一页。

批注会以正文样式出现在该段之后。

## 命令

| 命令 | 作用 |
|---|---|
| `/moyu` | 开关窗格（老板键）。没有书时恢复上一本 |
| `/moyu <path>` | 打开书库根下的文件，或把目录作为书架打开 |
| `/moyu hide` / `/moyu show` | 显式收起 / 显示 |
| `/moyu theme <auto\|mono\|paper\|ink>` | 跟随自己的配色（默认）或设预设 |
| `/moyu close` | 丢下书并关闭窗格 |

没有打开书时，`/moyu show` 会按保存位置重开上一本；最近列表为空则显示书架。

## 键盘

窗格是 less 形状的。

| 键 | 动作 |
|---|---|
| `↑` `↓` `←` `→`、`space` `b`、`j` `k` | 翻页 |
| `n` / `p` | 下一章 / 上一章 |
| `g` / `G`、`home` / `end` | 章首 / 章尾 |
| 点击 | 选中一段 |
| `a` | 把选中段引用进 prompt |
| `q`、`Escape` | 立刻收起 |
| `ctrl+g` | 窗格持有键盘时收起 |

`q` 既是 Client 键也是 Button hotkey，所以 `ctrl+x tab` 或 `closeOnEscape` 之后没有鼠标也能用。`ctrl+g` 在 Chat 上下文是宿主的外置编辑器和弦；窗格只在自己持键时吞掉它，所以老板键是 `q`。

## 模型工具

| 工具 | 用途 |
|---|---|
| `mcp__moyu__open` | 打开书库文件或目录 |
| `mcp__moyu__read` | 读当前页；`next` / `prev` / `chapter` 先翻页或跳章 |
| `mcp__moyu__find` | 全文查找，最多 20 条摘录 |
| `mcp__moyu__annotate` | 给段落 ref 加注 |
| `mcp__moyu__turn` | 按带符号增量翻页 |
| `mcp__moyu__boss` | 显示、收起或开关窗格 |

读取受 `snapshotMaxChars` 限制。ref 是规范化文本中的偏移，在下一次快照或翻页前有效。正文是不可信数据，不是指令。

## 配置

`/config` → moyu，或 `plugin.json` → `userConfig`：

| 选项 | 默认 | 含义 |
|---|---|---|
| `libraryRoot` | `novels` | 窗格可打开的目录。相对路径按工作目录解析，根外一律拒绝。 |
| `theme` | `auto` | `auto` 跟随自己的配色；`mono`（灰 CLI）、`paper`（暖褐）、`ink`（浅色）在显示期间使用预设。 |
| `autoHideSeconds` | `0` | 空闲这么多秒后收起；`0` 不收起。 |
| `snapshotMaxChars` | `12000` | 一次 `read` 的硬字符上限。 |

## 书库

- 根默认 `novels/`，相对会话工作目录，也可用绝对路径。
- 接受普通 `.txt`、`.md`、`.text`，扩展名不区分大小写；UTF-8 文本。
- 解析后的真实路径必须留在根内；逃逸的 `..` 拒绝，绝对路径指向根外也拒绝。
- 章节按 `第N章/回/节/卷`、`CHAPTER N`、`#` 标题和 `1.` / `1)` 行切分。没有标题的文档是一整章；首行不超过 60 字时作为书名。
- CRLF 与 BOM 归一化，保留 tab，丢弃其他控制字符。单段上限 2,000 字符。

完整设计见 [`docs/NOVEL.md`](docs/NOVEL.md)，适配器契约见 [`docs/PROVIDERS.md`](docs/PROVIDERS.md)。

## 架构

```text
hooks/entry.ts        唯一的 hooks 模块：captures、工具、命令、窗格
hooks/main.tsx        窗格渲染、按键路由、Ops 字面量
hooks/boss.ts         显隐、主题预设、空闲隐藏
hooks/tools.ts        工具 schema 与处理器
hub/hub.ts            串行动作队列、能力门禁、视图模型
hub/audit.ts          环形缓冲 + $.store 持久化
engine/provider.ts    适配器契约
engine/ops.ts         适配器可见的 $ 窄切片
providers/novel/      书库守卫、解析、分页、provider、按键条
tests/                内存书库上的插件套件
```

依赖指向内层。只有 `hooks/` 碰 `$`；只有 `providers/` 碰外部世界——这里是目录。Hub 与 provider 无关，并在执行前按声明的能力门禁。

Provider 实现 `open` / `snapshot` / `act`；`snapshot` 返回带角色的节点与字符偏移 ref，`act` 接受 `click`、`press`、`scroll` 和 provider `command`。保留契约是为了以后接游戏适配器。

## 安全与隐私

一切都在本地。读取被限制在解析后的根内，扩展名与真实路径都检查，正文按数据对待。窗格只填 prompt，从不提交。没有遥测。见 [`docs/SECURITY.md`](docs/SECURITY.md)。

## 兼容性与限制

- **终端：** 任何能画窗格的终端，不需要图形协议。
- **平台：** Windows、Linux、macOS；两种路径形状都会折叠。
- **仅交互：** 无头 `-p` 会加载工具，但不画窗格。
- **仅文本：** 不做 EPUB/PDF、不读网络小说、不支持图片、字体或间距、非 UTF-8 编码。
- **批注只在内存**，重开文件即清空；进度不会。
- **窄窗格**能用，但页会很短；窗格本身最低 20 列。
- 早期访问：功能钩子 API 会随 Claude Code 版本变化。

## 状态

0.4，早期访问。0.1–0.3 是浏览器线；0.4 用阅读器替换它，同时保留契约、队列、门禁、审计和监督器给后续适配器。钩子 API 稳定前版本号可能快速变化。

## 路线图

- 加固：更多解析边界、批注开关、单书书签。
- 在裁剪后的契约上做游戏适配器。
- 可选的第三方 provider。

不做：网络小说、EPUB、正文图片、多窗格焦点。

## 开发

```bash
npm run typecheck
npm run validate
npm run test:plugin
npm test                 # 以上三项
```

套件覆盖解析、分页、守卫、provider、hub、窗格与工具，全部跑在内存书库上；CI 在 Linux、Node 22 上执行。没有正文离开本机。

见 [`CONTRIBUTING.md`](CONTRIBUTING.md)，其中有一条值得记住的宿主规则：工具与命令注册必须是被扫描的纯 TypeScript hooks 模块里的字面调用。

## 常见问题

<details>
<summary>为什么按 <code>ctrl+g</code> 弹出的是编辑器而不是收起窗格？</summary>

`ctrl+g` 是 Claude Code 在 prompt 里的外置编辑器和弦。窗格只有持有键盘时才收得到。可靠的老板键是 `q`，它同时绑成普通键和 Button hotkey。
</details>

<details>
<summary>阅读位置存在哪？</summary>

插件存储的 `moyu.progress.<文档哈希>`，位置一稳定就写。删除插件存储会重置。批注不持久化。
</details>

<details>
<summary>它会改我的主题吗？</summary>

默认不改。`auto` 什么都不设置，窗格用你的主题 key 绘制。预设是显式的，窗格收起时会清掉。
</details>

<details>
<summary>能通过 SSH 在服务器上读同一个书库吗？</summary>

可以——窗格是终端文本，SSH 和 tmux 里都能用。书库必须在那台机器上。
</details>

## 参与贡献

欢迎 issue 与 PR。请先跑上面三项检查，并说明用哪个终端试过。参与即表示同意[行为准则](CODE_OF_CONDUCT.md)。

## 许可证

[MIT](LICENSE)。名字是个谐音梗，代码是普通 TypeScript。

致谢：Claude Code 功能钩子的作者，以及那些克制到让文本窗格成为正确形状的终端。
