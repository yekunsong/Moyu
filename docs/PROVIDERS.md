# Provider 作者指南

第一版只有 `browser` 一个 provider，但合同按多 provider 写。新增一个 provider 要做四件事：实现合同、声明能力、声明权限元数据、接进 hub。

## 1. 合同（`providers/browser/contract.ts` 是参考实现）

```ts
type Provider = {
  readonly meta: {
    id: string
    label: string
    capabilities: {
      pointer: boolean; keys: boolean; scroll: boolean; images: boolean;
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

### Snapshot

```ts
type SnapshotNode = {
  ref: string          // 稳定到下一次快照/导航；动作前校验，失效返回 stale
  role: string         // button/link/textbox/heading/text/...
  name: string         // 已压空白、截断
  depth: number
  value?: string       // 密码遮蔽
  interactive?: boolean
  submits?: boolean
  state?: { disabled?; checked?; expanded?; selected?; focused? }
  bounds: { x; y; w; h }
}
```

硬要求：

1. **ref 必须来自应用自身的对象身份**，不能是坐标或数组下标。浏览器用 `WeakMap<Element,string>`，其他 provider 用协议里的稳定 id。
2. **ref 失效必须显式报告**（`ActResult.stale = true`），让面板重取快照；不能静默点到别的东西。
3. **快照默认只含可见区**，并提供 `scope: 'document'` 的整页请求；两者都要服从 `maxChars`。
4. **值里不放凭证**；密码或 token 字段给占位符。

### Action

现有动作集合：`click` / `fill` / `select` / `focus` / `hover` / `press` / `scroll` / `navigate` / `back` / `forward` / `reload`。能力不足时：

- 不支持指针：隐藏面板点击，只留动作工具。
- 不支持键盘：不渲染键盘条。
- 支持的子集在 `capabilities` 里声明，`hub/negotiate.ts` 负责降级。

`ActResult` 必须带 `message`；成功且页面可能变化时 `changed: true`，hub 会据此刷新。

## 2. 传输

推荐沿用 browser 的模式：

- 一个受监督的本地子进程（`engine/supervisor.ts`），stdout 首行 `{"ready":true,"port":N}`。
- 回环 HTTP + 随机 bearer token。
- 端点至少：`/health`、`/snapshot`、`/act`、`/stop`。

不要假设插件模块里有 Node、DOM 或 PTY：`spawn` 的 stdin 一次性、没有 PTY，交互程序必须有自带协议。

## 3. 权限

在 `hub/permissions.ts` 的 `classify()` 里补动作分级（读 / 写 / 提交），在 `decide()` 里补协议与目标白名单。默认拒绝未知协议；写动作默认确认。

## 4. 渲染

文本档直接产出 `SnapshotNode[]` 就够；`hooks/main.tsx` 的 `projectRows` 会把它们变成按钮和文本。视觉档可选：实现 `raster()`，返回 `columns * rows` 个 u32 三元组 `[码点, 前景, 背景]` 的 base64。

## 5. 测试

1. 纯逻辑测试放在 `tests/*.test.ts`（`claude plugin test .`）。
2. 子进程协议测试用 `node:test`，仿照 `tests/bridge/bridge.test.mjs`。
3. 至少覆盖：快照结构、点击/填写、stale ref、协议拒绝、进程停止。
4. 在 `tests/helpers.ts` 里给 hub 加一个 fake 端点，保证插件测试不依赖真实进程。

## 6. 接入顺序

1. `providers/<name>/contract.ts`（能力与元数据）
2. `providers/<name>/client.ts`（Provider 实现）
3. `hub/registry.ts` 注册（第一版只有 browser，直接 new）
4. `hooks/main.tsx` 增加命令与工具命名空间
5. `types/index.d.ts` 若新增持久状态，补 `PluginState`
