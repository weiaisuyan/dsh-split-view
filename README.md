# dsh-split-view

Hermes 式多栏工作区，接管 DSH 主区：每栏一条自己的标签条、拖拽分栏、可关闭，最多四栏。

## 安装

需要 DSH `0.2.1-rc.5` 及以上。装完**重启 DSH** 才会生效。

### 方式一（推荐）：npm

在 DSH「设置 → 添加插件」里粘贴包名：

```
@weiaisuyan/dsh-split-view
```

或者命令行：

```sh
npx @deepseek-ai/dsh plugin --profile desktop add @weiaisuyan/dsh-split-view
```

npm 走公共 registry，有国内镜像可用，比 GitHub 稳。

### 方式二：GitHub 直装

拿到的是 `main` 分支当前代码（可能比 npm 上的新），需要能访问 GitHub。

```sh
npx @deepseek-ai/dsh plugin --profile desktop add github:weiaisuyan/dsh-split-view
```

### ⚠️ 不要和 npm 上的 `dsh-split-view` 混装

npm 上有一个**同名不同源**的插件 `dsh-split-view`（作者 luckybilly），它也是给 DSH 做多会话分屏的，但实现路线完全不同（每栏跑一个 iframe 客户端）。两者装名会撞车：

| 来源 | 安装名 |
| --- | --- |
| 本插件（npm） | `@weiaisuyan/dsh-split-view` |
| 本插件（GitHub 直装） | `dsh-split-view`（取自仓库 package.json） |
| 另一个作者的插件 | `dsh-split-view` |

也就是说 **GitHub 直装的版本和 luckybilly 那个包同名**。两个都装会互相覆盖，表现出来是「插件时有时无、改了没反应」。装之前先确认机器上没有另一个 `dsh-split-view`。

### 卸载

```sh
# npm 装的
npx @deepseek-ai/dsh plugin --profile desktop remove @weiaisuyan/dsh-split-view
# GitHub 装的
npx @deepseek-ai/dsh plugin --profile desktop remove dsh-split-view
```

### 升级

手动安装通道不支持自动更新：

- **npm 装**：重跑一次 `add`（或先 `remove` 再 `add`）
- **GitHub 装**：必须 `remove` 后重新 `add`，否则不会拉到新提交

## 交互

| 动作 | 结果 |
| --- | --- |
| 点侧栏「多栏视图」 | 打开本插件的设置页（启用 / 关闭开关） |
| 设置页里打开开关 | 立刻进入工作区，之后打开 App 直接是工作区（默认启用） |
| 设置页里关掉开关 | 立刻回到 DSH 原生单栏视图 |
| 点侧栏会话（工作区开着） | **替换**当前焦点栏的活动标签；设置页或原生视图下点会话也会切回工作区 |
| 点侧栏会话（该会话已在任意栏显示） | 不新增也不替换，焦点跳到显示它的那个标签 |
| 从侧栏把会话**拖**进某一栏的标签条 / 正文中间 | 在该栏**追加**一个新标签（不会新开栏） |
| 把**标签**（或侧栏会话）拖到某栏**正文的最外侧 20%**（左或右） | 在那一侧**新开一栏**，被拖的标签落进新栏（Hermes 手感） |
| 把**标签**拖到**栏中间**或**标签条** | 把标签移到那一栏（合并进去），不分栏 |
| 把会话拖到栏与栏之间的分隔条 | 在分隔条位置**新开一栏** |
| 拖动悬停时（还没松手） | 外侧 → 半透明幽灵栏 + 布局小图 + 「松手：在这一栏右侧新开一栏」；标签条/中间 → 虚位标签「松手：加到这一栏」；分隔条 → 「松手：插到这一栏的位置」 |
| 标签上的 `×` | 关闭标签 |
| 标签**中键单击** / **双击** | 关闭标签 |
| 每栏标签条上的 `+` | 在该栏新建空标签（空白标签 = 新会话页，带完整输入框） |
| 拖动栏间分隔条 | 调整栏宽 |
| 底部状态条 | 常显，跟随焦点栏的活动标签：会话名、轮次、用量、缓存命中、智能体用时 |

窗口宽度 < 900px 时自动改为纵向堆叠。

## 视觉对齐

- 每栏的标签条高 44px、贴在主区最顶端，与 DSH 原生的标题 / 工具栏那一行同一高度；
  分栏后每栏的标签条各自对齐自己那一列。
- 焦点栏的标签条顶部有一条 2px 主题色高亮，活动标签底色更亮。
- 桌面 App 用隐藏标题栏 + 系统按钮叠加层（titleBarOverlay），窗口按钮不是页面元素：
  插件会在运行时量出这块区域，把最后一栏标签条的右侧按钮让开，避免被窗口按钮盖住。
  取窗口按钮宽度的公式是 `innerWidth - (area.x + area.width)`；
  旧写法 `innerWidth - area.x` 会算出整个窗口宽度，被 `inset < innerWidth/2` 的护栏判成 0，
  于是让位永远不生效（2026-11-06 修正）。
  实测这台机器的 App 里，工作区整体起始于 y=40，窗口按钮只占 y 0..40，
  两者天然不重叠，所以 `--dsv-caption-inset` 算出来是 0px 属于正确结果。

## 布局持久化

- 栏、标签、当前标签、栏宽比例存在 `localStorage` 的 `dsh-split-view:workspace:v1`，重开 App 原样恢复。
- 启用状态存在 `dsh-split-view:prefs:v1`，只写 `enabled`。
  **设置页不会被持久化**——「点多栏才生效」的老毛病就是因为它被存下来、每次启动又落回设置页。
- 老版本留下的 `{"enabled":false,"showSettings":true}` 会被当成「已启用」读回来，不会再把用户困在设置页。

## 实现要点

- 注册一个 `main` 面板（`key: "split-view"`），启动时若主区还是原生对话就自动切过来。
- 对话内容用 `renderFactorySlot("conversation.content", { variant: "embedded", … })` 渲染——
  这是宿主自己的对话工厂，所以每栏都是**完整的原生对话**：消息流、输入框、工具调用、
  附件，以及其它插件挂在会话里的东西（费用明细、上下文占用等底部统计、专家选择器…）。
- 每栏用 `SessionProvider session={{ sessionId, binding }}` 显式绑定自己的会话；
  reference 每次渲染都从 `sessions.binding()` 现算，避免 scope 重建后留下过期 token。
- 每栏进入时 `sessions.retain(id, { source: "splitView" })` 让控制器物化 scope，
  卸载时 `release()`；会话还没被控制器认识时按 250ms 重试（重载后恢复布局必需）。
  retain 用模块级引用计数 + **500ms 释放宽限**（`RELEASE_GRACE_MS`）：把一个标签拖到别的栏时
  旧子树会先卸载、新子树后挂载，若立刻 `release()` 会把会话释放到 0 并报
  `conversation.input: session … resolved no binding`，宽限期内被重新 retain 就撤销释放。
- 点击接管：包装 `uiWorkspace.openSession`。宿主自己实现里会 `selectPanel(null)` 把主区
  切回原生对话，所以工作区开着时不能再走原实现，必须直接路由到面板。
- 拖拽接管：宿主不往 `dataTransfer` 写数据，所以在 document 捕获阶段从
  `[data-row-key^="session:"]` 上自己取会话 id。
- **拖标签分栏**（Hermes 手感，无按钮）：拖拽时按落点算 `dropSideIn(rect, clientX)`——
  正文最外侧 20% → `left` / `right`，中间与**整条标签条** → `null`；`dropTab()` 在边缘位置
  insert 一个新栏（权重按 `总权重/(n+1)` 均分），中间则合并进目标栏。标签条的 `dragover`
  会 `stopPropagation()`，否则事件冒泡到 `Pane` 的处理器又按 x 坐标算出左右边缘、把「加标签」
  误判成「分栏」（2026-11-07 用户反馈的问题）。落点用 `data-drop-side` 属性驱动左右高亮
  （`.dsv-pane[data-drop-side]` 的内阴影），`onDragLeave` 判断 `node.contains(relatedTarget)`
  避免子元素间移动时抖动。
- **松手前预览**：`hover` 状态（`{paneId, side, kind}`，分隔条是 `{index, kind:"divider"}`）
  由各个 `dragover` 写入，`DragPreview` 画幽灵栏（半宽、`data-side`、布局小图、文案），
  `PaneHeader` 画虚位标签，`Divider` 用 `data-preview` 出文案；`dragend` / `drop` 一律清空。
- **标签条只有 `+`**：不提供 `⊞ 拆出新栏`、`⊟ 关闭这一栏`、`⚙ 多栏设置`。分栏靠拖标签，
  关栏靠关掉/拖走该栏最后一个标签（`closeTab` 在还有别的栏时直接收掉这一栏），
  设置只从侧栏「多栏」入口进。
- **「新建会话」= 新标签**：`bridge.openTab()` 用 `openSession(…, "tab")`，绝不复用
  「侧栏当前选中项」、也不 `replace` 掉当前对话；新会话 id 从 `createNamed` /
  `createInWorkspace` / `replaceMain` / `sessions.create` 四个入口的参数与返回值里捕获，
  捕获不到就在 12s 窗口内找最新会话，再不行才开空白标签。
- 性能：栏/标签树只在**结构变化**时重渲染（`useRowMap` 用「id|标题|运行中|空白」签名做门），
  流式输出只重渲染对应那一栏的对话，不会带着所有栏一起抖。
- 三层错误边界：`WorkspaceBoundary`（整块崩了给"回到单栏视图"）、`PaneBoundary`（单栏崩了不影响别栏）、
  宿主自己的 `SlotErrorBoundary`。任何失败都不会白屏。
- **新建会话不会掉出工作区**：侧栏「新会话」/`Ctrl+Alt+N`/登录后建会话走的是
  `uiWorkspace.startSession → openWorkspace → openWorkspaceSession → connectBlank →
  createInWorkspace → createNamed → layout.selectPanel(null)`，全程不经过 `openSession`。
  所以另外包装 `createNamed` / `createInWorkspace` 记下新会话 id（`pendingNew`），
  再在 `layout.selectPanel` 的钩子里拦下 `null`：有新鲜 id 就把它开成标签，
  没有就比对新旧焦点会话，再不行才退回空白标签。**绝不**放它把主区切回原生单栏。
- 包装宿主方法必须**可逆**：先存原 descriptor（`globalThis.__dshSplitViewHooks`），
  卸载时**还原 descriptor**，不能用 `delete proto[name]`。
  宿主的方法挂在原型上，`delete` 删的是类方法本身——插件热重载一次就会把
  `selectPanel` / `openSession` 从宿主原型上永久抹掉，整块 App 报
  `ctx.layout.selectPanel is not a function` 并退回原生视图。
- 0.2.2-rc.1 把所有 client 插件打成**一个** concatenated bundle：
  任何一个插件语法/导入出错，同批次全部插件一起 `import failed`
  （2026-11-06 21:32 的 App 崩溃就是这么来的，5 个插件一起挂）。改完先 `node --check`。

## 安装 / 卸载

```powershell
dsh plugin --profile desktop add "file:C:/Users/weiai/.dsh/plugin-src/dsh-split-view"
dsh plugin --profile desktop remove dsh-split-view
```

### 源码位置与目录联接（2026-11-06 起）

真源**不在 OneDrive**：`<local-path>`（两端路径相同）。
profile 里的 `node_modules\dsh-split-view` 现在是**目录联接（Junction）**，直接指向真源目录：

```powershell
Get-Item "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-split-view" | Select-Object LinkType,Target
# LinkType=Junction  Target=<local-path>
```

所以**改真源即时生效**，不用复制、不用重建链接，只需重启 App（或等它热重载）。
（早期 pnpm 装出来的是硬链接，`write`/`edit` 这类"写临时文件再改名"的编辑会把硬链接换成新 inode，
导致 profile 副本静默留在旧版本——这是 2026-11-07 换成 Junction 的原因。若哪天 `LinkType` 又变回
`HardLink`，重跑一次下面两条重建：
`Remove-Item <profile>\node_modules\dsh-split-view -Recurse -Force` +
`New-Item -ItemType Junction -Path <profile>\node_modules\dsh-split-view -Target <local-path>`）
改完只需要**重启 App**。

### 两台机器同步（重要）

2026-11-06 21:32 的事故：以前的真源在 OneDrive 里的 `Documents\...\dsh-split-view`，
两台机器是同一目录的两个副本，笔记本侧一保存就把台式机刚改好的版本盖回去，且不留冲突副本。
现已整体迁出 OneDrive（旧目录已删）。

约定：**台式机写，笔记本只读**。同步走脚本：

```powershell
<local-path>          # 只比对（0=一致，1=有漂移）
<local-path> -Push    # 台式机 -> 笔记本
```

脚本用 SSH 走 Tailscale（`<user>@<private-ip>`，密钥 `~/.ssh/<ssh-key>`）。
笔记本的 sshd 由计划任务在用户登录后拉起，睡眠/未登录时连不上。

## 已知问题

- 渲染非活动会话时，宿主 `/api/changes.summary` 会返回 404（该接口只对已附加会话提供数据）。
  不影响对话正文、输入框和工具调用。
- 会话级的上下文占用（`contextPressure` / `contextBreakdown`）只在会话 scope 内可读，
  多栏状态条拿不到，所以状态条显示的是用量与缓存命中；每栏内宿主原生的底部统计仍然照常显示占用百分比。
- 智能体插件的入口没有 `aria-label`：图标按钮的可访问名是文字「专家」、`title="召唤专家"`。
  探针用 `aria-label` 扫会误判成"没有智能体"，要按文字或 `title` 找。

## 台式机实测（2026-11-06 22:30，Electron 44.7.0 / DSH 0.2.2-rc.1）

三栏状态下在真 App 里量到的数（窗口 1279×900 CSS，dpr 1.5）：

| 位置 | 实测 |
| --- | --- |
| 工作区根 `.dsv-root` | `x=280 y=40 w=999 h=860` |
| 三条标签条 | 都 `top=40 height=45`，右边界 608 / 944 / 1279 |
| 最右一栏 `+` | `x=1174..1194, y=52..72` |
| 最右一栏 `⊞` | `x=1198..1222, y=52..72` |
| 最右一栏 `⊟` | `x=1224..1247, y=52..72` |
| 最右一栏 `⚙` | `x=1249..1271, y=52..72` |
| 系统窗口按钮区 | `x=1142..1279, y=0..40`（`getTitlebarAreaRect()` 宽 1142、`controlsWidth`=137） |

结论：按钮在 y 52..72，窗口按钮在 y 0..40，**垂直方向不重叠**，
`elementFromPoint` 落在每个按钮上返回的就是它自己，没有被窗口的最小化/关闭按钮盖住；
最右按钮距右边缘 8px。标签条顶边与原生标题/工具栏行同为 y=40，齐平。
每栏的输入框与插件内容实测齐全（停止/发送、添加文件、访问模式、专家、选择模型、
轮次步数、费用明细、tok 与缓存命中、上下文已用）。
