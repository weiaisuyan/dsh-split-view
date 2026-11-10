# dsh-multipane（多栏视图）

Hermes 式多栏工作区，接管 DSH 主区：每栏一条自己的标签条、拖拽分栏、可关闭，最多四栏。

## 安装

需要 DSH `0.2.1-rc.5` 及以上。装完**重启 DSH** 才会生效。

> **名字必须三处一致**：`package.json` 的 `name`、`cordis.patch.yml` 的 `name`、`lib/client.js` 里的模块 `id`
> 三者要完全相同，否则 DSH 会静默不加载（控制台报 `import failed` / `duplicate factory registration`）。
> 所以本项目**不做发布期改名**，本地开发名和 npm 包名就是同一个 `dsh-multipane`。

### 方式一（推荐）：npm

在 DSH「设置 → 添加插件」里粘贴包名：

```
dsh-multipane
```

或者命令行：

```sh
npx @deepseek-ai/dsh plugin --profile desktop add dsh-multipane
```

npm 走公共 registry，有国内镜像可用，比 GitHub 稳。

### 方式二：GitHub 直装

拿到的是 `main` 分支当前代码（可能比 npm 上的新），需要能访问 GitHub。

```sh
npx @deepseek-ai/dsh plugin --profile desktop add github:weiaisuyan/dsh-split-view
```

仓库名仍是 `dsh-split-view`，但包名取自 `package.json`，装下来同样叫 `dsh-multipane`。

### ⚠️ 别和作者 luckybilly 的 `dsh-split-view` 同时启用

npm 上另有一个插件 `dsh-split-view`（作者 luckybilly），也是给 DSH 做多会话分屏，实现路线完全不同（每栏跑一个 iframe 客户端）。

| 来源 | 安装名 |
| --- | --- |
| 本插件（npm / GitHub 装法都一样） | `dsh-multipane` |
| 另一个作者的插件 | `dsh-split-view` |

两者**名字不同、不会互相覆盖**，但都在抢主区，同时启用会互相打架（栏结构错乱、设置页串台）。只留一个，装前先确认：

```sh
npx @deepseek-ai/dsh plugin list | grep split-view
```

如果你装过本插件的旧版本（`@weiaisuyansjd/dsh-split-view`，或 GitHub 直装的 `dsh-split-view`），先按下面的命令卸掉再装新版。

### 卸载

```sh
npx @deepseek-ai/dsh plugin --profile desktop remove dsh-multipane
# 旧版本（如果装过）
npx @deepseek-ai/dsh plugin --profile desktop remove @weiaisuyansjd/dsh-split-view
npx @deepseek-ai/dsh plugin --profile desktop remove dsh-split-view
```

### 升级

手动安装通道不支持自动更新：

- **npm 装**：重跑一次 `add`（或先 `remove` 再 `add`）
- **GitHub 装**：必须 `remove` 后重新 `add`，否则不会拉到新提交

升级/换装都不会丢布局：栏、标签、栏宽存在 `localStorage`（键名固定为 `dsh-split-view:*`，与包名无关）。

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
| **拖文件 / 图片到某一栏内**（1.0.4+） | **只加到那一栏的草稿**；拖动期间目标栏边框高亮，宿主那个全屏「拖到此处添加」遮罩不再出现 |
| 拖文件到**侧栏 / 底栏 / 顶部标题栏** | **一律拒绝**（光标显示禁止，松手不加） |
| **`Ctrl+Tab` / `Ctrl+Shift+Tab`**（1.0.5+） | 在**当前栏**的标签之间前后切换，循环，不跨栏 |
| 底部状态条 | 常显，跟随焦点栏的活动标签：会话名、轮次、用量、缓存命中、智能体用时；宿主原生统计行（费用明细等）整行搬进来，按钮保持可点 |

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

真源**不在 OneDrive**：`C:\Users\weiai\.dsh\plugin-src\dsh-split-view`（两端路径相同）。
profile 里的 `node_modules\dsh-split-view` 现在是**目录联接（Junction）**，直接指向真源目录：

```powershell
Get-Item "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-split-view" | Select-Object LinkType,Target
# LinkType=Junction  Target=C:\Users\weiai\.dsh\plugin-src\dsh-split-view
```

所以**改真源即时生效**，不用复制、不用重建链接，只需重启 App（或等它热重载）。
（早期 pnpm 装出来的是硬链接，`write`/`edit` 这类"写临时文件再改名"的编辑会把硬链接换成新 inode，
导致 profile 副本静默留在旧版本——这是 2026-11-07 换成 Junction 的原因。若哪天 `LinkType` 又变回
`HardLink`，重跑一次下面两条重建：
`Remove-Item <profile>\node_modules\dsh-split-view -Recurse -Force` +
`New-Item -ItemType Junction -Path <profile>\node_modules\dsh-split-view -Target C:\Users\weiai\.dsh\plugin-src\dsh-split-view`）
改完只需要**重启 App**。

### 两台机器同步（重要）

2026-11-06 21:32 的事故：以前的真源在 OneDrive 里的 `Documents\...\dsh-split-view`，
两台机器是同一目录的两个副本，笔记本侧一保存就把台式机刚改好的版本盖回去，且不留冲突副本。
现已整体迁出 OneDrive（旧目录已删）。

约定：**台式机写，笔记本只读**。同步走脚本：

```powershell
C:\Users\weiai\.dsh\plugin-src\_probe\sync-client.ps1          # 只比对（0=一致，1=有漂移）
C:\Users\weiai\.dsh\plugin-src\_probe\sync-client.ps1 -Push    # 台式机 -> 笔记本
```

脚本用 SSH 走 Tailscale（`weiai@100.111.58.70`，密钥 `~/.ssh/id_ed25519_to_laptop`）。
笔记本的 sshd 由计划任务在用户登录后拉起，睡眠/未登录时连不上。

## 已知问题

- 渲染非活动会话时，宿主 `/api/changes.summary` 会返回 404（该接口只对已附加会话提供数据）。
  不影响对话正文、输入框和工具调用。
- 会话级的上下文占用（`contextPressure` / `contextBreakdown`）只在会话 scope 内可读，
  多栏状态条拿不到，所以状态条显示的是用量与缓存命中；每栏内宿主原生的底部统计仍然照常显示占用百分比。
- 智能体插件的入口没有 `aria-label`：图标按钮的可访问名是文字「专家」、`title="召唤专家"`。
  探针用 `aria-label` 扫会误判成"没有智能体"，要按文字或 `title` 找。
- 拖放定向依赖宿主的 `conversation.input.attachments` 槽位（`kind: single`、`priority` 覆盖语义、
  `entry.component` / `entry.inject`）。宿主升级若改了这些，插件**会自动检测失败并退回官方行为**
  （多栏拖文件仍会加到每一栏），不会崩溃；届时需按 skill 踩坑档第 72 条跟进修一遍。
- 拖动文件那几秒，各栏的附件栏（已加的缩略图）暂时不渲染 —— 这是刻意的：宿主那个全屏
  「拖到此处添加」遮罩会盖住所有栏、让人没法选目标栏。松手立刻恢复。

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

## 更新记录

### 1.0.10（2026-11-10）
- **修「关掉多栏视图后侧栏样式还在」**：关闭时只清了 `data-dsv-row`，没有删除插件自己的样式表——而其中
  `[data-row-key^="session:"]:not([data-dsv-row]) * { opacity: .5 }` 这条**不需要任何行标记**，
  只要样式表还在，所有会话行的文字就一直是暗的。现在关闭/卸载时把样式表、43 个 `--dsv-*` 变量、
  `data-dsv-row` / `data-dsv-pulse` 标记和复用来的 `_selected` 类一起清掉；重新启用时整体恢复。

### 1.0.9（2026-11-10）
- **修「最暗 / 最亮两个圆点不在滑轨上」**：滑杆的滑块被 Chromium 顶在轨道顶部（不自动居中），实测圈心比轨道中心高 5px；补 `margin-top` 并按 border-box 计算宽度。
- **修「调悬停浓度时预览没反应」**：预览里新增一个固定的「悬停」标签，调「悬停时浓度」能实时看到那条线的变化。
- **拖动滑杆时暂停预览里的呼吸**：呼吸一直在闪就看不出正在调的底色浓度；松手立刻恢复。
- **修「有状态点的标签被压扁、挡住文字」**：宽度计算漏了状态点 + 间隙的 9px（实测无点标签余 3.7px、加上绿点就变成缺 5px 被裁）。现在按「会不会画状态点」分别计算。
- **修偶发的「标签全被压成 12px」**：栏宽还没量到时（刚挂载 / 从最小化恢复）会走到极限压缩分支，之后 ResizeObserver 不再回调就一直不恢复；现在未量到宽度时按理想宽渲染，并补 8 次延迟重测。
- **设置页新增「检查更新」**：显示当前版本，点一下去 npm 查最新版并告诉你安装命令（只读，不改任何文件）。

### 1.0.8（2026-11-10）
- **侧栏「运行中呼吸」**：会话执行任务时，它在侧栏那一行的底色一浓一淡地呼吸，用来表示"正在干活"。
  状态取自会话真实的运行标记，不是估算。四类会话（已激活 / 已打开且显示 / 已打开未显示 / 未打开）各自一套
  「最暗 ↔ 最亮 ↔ 节奏」，后两类可勾选"跟随已打开且显示"。
- **设置页改版**：状态徽章、四个分区（基本 / 界面元素 / 外观 / 备份与恢复）、卡片悬停、底部「怎么用」要点。
- **备份与恢复**：把设置导出成 JSON 文件（系统另存为），换机器或重装后导回即可还原全部外观与开关；文件不含会话内容。
- 预览里的会话名改用状态名（激活会话 / 打开并显示 / 打开未显示 / 未打开会话），不再显示真实会话标题。
- 修复：连点多个「展开」只有一个生效。

### 1.0.7
- 底栏不再同时显示两份统计（原生行 + 兜底统计），并修掉 0.5 秒来回切换的闪烁。

### 1.0.6 及更早
- 底栏统计行不再抓住被宿主抛弃的节点（「费用明细」等按钮恢复可点）；Ctrl+Tab 栏内切标签；拖放只接受栏内等。
