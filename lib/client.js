window.__ModuleLoader__.load({
	id: "dsh-split-view",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let react = require("react");
		const h = react.createElement;

		//#region constants
		const PANEL_ID = "split-view";
		/**
		 * 插件显示名（侧栏入口 + 设置分区标题都用它）。
		 *
		 * 改名字只改这一行。四个字，与「多栏」语义衔接。
		 */
		const PLUGIN_LABEL = "多栏视图";
		const STORAGE_KEY = "dsh-split-view:workspace:v1";
		const STYLE_ID = "dsh-split-view-style";
		const CONTENT_FACTORY = "conversation.content";
		const PANE_SLOT = "split-view.pane";
		const RETAIN_SOURCE = "splitView";
		/* ⚠️ 不要用 "mainView" 当保留来源。
		   踩过两次坑：
		     ① 只用 "splitView" → retainedBy.mainView 恒 0 → 宿主 completionUnread 永不清除
		        （点开看过的会话绿点还在）
		     ② 改用 "mainView" → 和宿主自己的 blank 会话**同时**持有 mainView，
		        而宿主 mainSessionId = 「第一个含 mainView 的会话」（按 byId 键顺序猜），
		        于是侧栏"新会话"那一行时而出现时而不出现（2026-11-07 用户实测）
		   正解：保留仍用 "splitView"，但**直接清宿主的 completionUnread 集合**
		   （见 clearHostUnread）—— 精准、无副作用。 */
		const MAX_PANES = 4;
		const MIN_WEIGHT = 0.18;
		/**
		 * 标签宽度策略 —— 直接照搬 Chromium 的 TabStripLayout 算法
		 * （chrome/browser/ui/views/tabs/tab_strip_layout.cc 的 TabSizer）。
		 *
		 * 三档宽度：
		 *   MIN      ：只放得下图标 + 关闭按钮，标题隐藏
		 *   CROSSOVER：标题开始出现（"刚好能读"）
		 *   PREFERRED：完整标题的理想宽度，再多也不加宽
		 *
		 * 空间充足度 spaceFraction ∈ [0,1] 决定一切：
		 *   space < crossover → 第一段：在 MIN..CROSSOVER 之间插值（标题逐渐出现）
		 *   space ≥ crossover → 第二段：在 CROSSOVER..PREFERRED 之间插值（标题逐渐变宽）
		 * 然后再用 AllocateExtraSpace 把取整剩下的零头从左到右每格 +1px 分掉，
		 * 所以整条标签会精确铺满、不会留缝也不会溢出。
		 */
		const TAB_MIN_PX = 46;          /* 极限压缩：图标 + × */
		const TAB_CROSSOVER_PX = 96;    /* 标题开始显示 */
		const TAB_PREFERRED_PX = 200;   /* 理想宽度的上限（真正的理想宽按标题文字算，见 tabIdealWidth） */
		/* 标签里除了文字之外的固定占位：左 padding 9 + 右 padding 6 + 关闭按钮 18 + 间隙 4
		   + 状态点 6 + 间隙 4 + 边框 2 ≈ 49，取 52 留一点余量。 */
		const TAB_LABEL_CHROME_PX = 36;
		const TAB_GAP_PX = 2;           /* 标签之间的间距 */

		/**
		 * 按 Chromium 的两段插值算出这一组标签每个的宽度。
		 *
		 * @param available 标签条可用宽度（px）
		 * @param count 标签数量
		 * @returns 每个标签的宽度数组（总和 ≤ available）
		 */
		let tabMeasureCanvas = null;
		const TAB_LABEL_W_CACHE = new Map();
		/**
		 * 一个标签「刚好放下它的标题」需要多宽：文字宽 + 关闭按钮等固定占位。
		 * 用 canvas 量文字（与布局解耦，窄栏下也准），并按标题做缓存。
		 */
		function tabIdealWidth(label) {
			const text = String(label ?? "");
			const cached = TAB_LABEL_W_CACHE.get(text);
			if (cached !== void 0) return cached;
			let textW = text.length * 12.5; /* 兜底：按中文宽估 */
			try {
				if (tabMeasureCanvas === null) tabMeasureCanvas = document.createElement("canvas");
				const ctx2d = tabMeasureCanvas.getContext("2d");
				if (ctx2d !== null) {
					ctx2d.font = "500 12.5px system-ui, 'Segoe UI', 'Microsoft YaHei', sans-serif";
					textW = ctx2d.measureText(text).width;
				}
			} catch {
				/* 忽略：用估算值 */
			}
			const width = Math.ceil(textW) + TAB_LABEL_CHROME_PX;
			TAB_LABEL_W_CACHE.set(text, width);
			return width;
		}

		function layoutTabWidths(available, count, idealWidths) {
			if (count <= 0) return [];
			/* 每个标签的理想宽 = 自己标题的文字宽 + 固定占位（关闭按钮等），夹在 MIN..PREFERRED。
			   以前统一 200 且下限被 CROSSOVER(96) 卡住 —— 「新会话」只要 70 多像素，
			   却被撑到 96，多出来的全落在名字和 × 之间（用户 2026-11-09 报的就是这个）。 */
			const ideals = [];
			for (let index = 0; index < count; index += 1) {
				const raw = idealWidths !== void 0 && idealWidths[index] !== void 0 ? idealWidths[index] : TAB_PREFERRED_PX;
				ideals.push(Math.max(TAB_MIN_PX, Math.min(TAB_PREFERRED_PX, Math.round(raw))));
			}
			const gaps = TAB_GAP_PX * Math.max(0, count - 1);
			const usable = Math.max(0, available - gaps);
			const minTotal = TAB_MIN_PX * count;
			const prefTotal = ideals.reduce((sum, width) => sum + width, 0);
			/* 极端情况：连 MIN 都放不下（栏被拖得极窄）。按可用宽度均分，宁挤不裁。 */
			if (usable < minTotal) {
				const each = Math.max(12, Math.floor(usable / count));
				const out = [];
				for (let index = 0; index < count; index += 1) out.push(each);
				let extra = usable - each * count;
				for (let index = 0; index < out.length && extra > 0; index += 1) { out[index] += 1; extra -= 1; }
				return out;
			}
			/* 放得下就各自用理想宽，**多余空间留在标签条右侧**，不再摊进标签里。 */
			if (usable >= prefTotal) return ideals.slice();
			/* 放不下：按各自理想宽等比压缩（不低于 MIN），再把取整零头补回去，尽量铺满。 */
			const scale = prefTotal === 0 ? 1 : usable / prefTotal;
			const widths = ideals.map((ideal) => Math.max(TAB_MIN_PX, Math.floor(ideal * scale)));
			let extra = usable - widths.reduce((sum, width) => sum + width, 0);
			for (let index = 0; index < widths.length && extra > 0; index += 1) { widths[index] += 1; extra -= 1; }
			return widths;
		}

		/* 单栏最小像素宽度：拖动分隔条不能把任何一栏压得比这更窄。
		   权重下限（MIN_WEIGHT）在栏多时仍然可能算出很窄的像素宽度，
		   所以要再按像素卡一道。 */
		/* 一栏最窄多少像素。
		 * 220 时代实测出过问题：宿主那边的右侧按钮组（日志下载 / 更多操作 /
		 * 底部面板 / 上下文诊断 / 右栏）总宽能到 428px，栏一窄就整组溢出、被
		 * .dsv-paneheader 的 overflow:hidden 裁掉，用户看到「右分栏的侧边栏
		 * 按钮没有显示」。340 是能让那组按钮基本完整的最小实用宽度。
		 * （右栏按钮另外还做了绝对定位常驻，见 .dsv-hostbar [data-slot-place="corner"]，
		 *  所以即使更窄它也一定在。） */
		const MIN_PANE_PX = 340;
		/* 只有**窗口总宽**小于这个值才改成竖向堆叠；用户把某一栏拖窄不该触发竖排。 */
		const STACK_BREAKPOINT_PX = 900;
		const EMPTY_LIST = { ids: [], byId: {} };
		const NATIVE_PANEL = null;
		/* Set on every WorkspaceRoot render: the prop bag the host injects into this
		   slot entry (renderSlot / renderFactorySlot / SessionProvider / the useX
		   hooks). The per-pane session header is itself a host slot entry and needs
		   the same props, so they are stashed here instead of being threaded through
		   Pane → TabContent → SessionHead. */
		let HOST_SLOT_PROPS = null;

		/**
		 * The desktop app runs a hidden title bar with a transparent overlay, so the
		 * OS paints the window buttons (minimise / maximise / close) into the top-right
		 * corner of the page — 42px tall, about 140px wide. The tab strips ride that
		 * same line, so the last one has to stop short of the overlay or its own
		 * buttons disappear underneath the window controls.
		 */
		const DESKTOP_SHELL = typeof navigator !== "undefined" && /Electron/i.test(String(navigator.userAgent ?? ""));

		/** Services captured once at apply() time — the slot kit never carries them. */
		const SERVICES = { ctx: void 0, sessions: void 0, layout: void 0, uiWorkspace: void 0 };

		/** Resolve a service lazily: cordis may materialise it after apply() ran. */
		function service(name) {
			const ctx = SERVICES.ctx;
			if (ctx === void 0) return void 0;
			try {
				return ctx.get(name) ?? void 0;
			} catch {
				return void 0;
			}
		}

		function resolveSessions() {
			if (SERVICES.sessions === void 0) SERVICES.sessions = service("sessions");
			return SERVICES.sessions;
		}

		function resolveWorkspaceService() {
			if (SERVICES.uiWorkspace === void 0) SERVICES.uiWorkspace = service("uiWorkspace");
			return SERVICES.uiWorkspace;
		}

		/** Handles the panel publishes so document-level bridges can drive it. */
		const bridge = {
			open: null,
			openSettings: null,
			/* Published by the mounted workspace: `blank` opens a fresh tab, and
			   `focusedSession` tells whether a session the host created is already
			   on screen (so the follow-up navigation can be skipped). */
			blank: null,
			focusedSession: null,
			selfSelect: false,
			routing: false
		};

		/**
		 * A session id waiting for the workspace to mount. Clicking a session while
		 * the panel shows the settings page (or the native view) has no live bridge
		 * yet, so the request parks here and the panel picks it up on mount.
		 */
		const pendingOpen = { sessionId: null };

		/**
		 * The session the host created a moment ago (新建会话 / Ctrl+Alt+N / any
		 * other new-session entry point).
		 *
		 * Every one of those flows ends the same way: create the session, then ask
		 * the layout for the native panel (`selectPanel(null)`) so the single-pane
		 * view can show it. With the workspace switched on that switch is exactly
		 * what threw the user back to the native view, and the created id was never
		 * announced anywhere the plugin could see. Capturing it here lets the panel
		 * hook adopt the session into the workspace instead.
		 */
		const pendingNew = { id: null, at: 0 };
		/* 关掉「唯一栏的最后一个标签」时，不要留 sessionId=null 的空白标签 ——
		   宿主的 conversation.content 会把**当前焦点会话**渲染进空白标签，
		   看起来就是「旧内容残留在页面上」（2026-11-07 用户实测）。
		   正确做法：走宿主的新建会话流程，拿到新 id 后**替换**当前标签。
		   期间旧标签保持原样，用户看不到中间态。 */
		const pendingReplace = { on: false };
		/* ── 会话状态三态推导（用户 2026-11-07 设计）────────────────────────
		   宿主只给了一个 running 字段，另外两态自己推：
		     running      = row.running === true                     → 进行中
		     done/unread  = 曾经 running 过、现在不 running，且用户没看过 → 未读
		     read         = 用户激活过（该会话当过焦点标签）           → 已读
		   判据「曾经跑过」= 本会话在运行中列表里出现过（runningEver）。
		   「看过」= 它当过焦点栏的激活标签（focusSeen）。两者都持久化，
		   重启后未读状态不会丢。 */
		const STATUS_KEY = "dsh-split-view:session-status:v1";
		const statusStore = (() => {
			try {
				const raw = window.localStorage.getItem(STATUS_KEY);
				if (raw === null) return { ranEver: [], seen: [], unreadDone: [] };
				const parsed = JSON.parse(raw);
				const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
				return { ranEver: arr(parsed?.ranEver), seen: arr(parsed?.seen), unreadDone: arr(parsed?.unreadDone) };
			} catch {
				return { ranEver: [], seen: [], unreadDone: [] };
			}
		})();
		const statusSave = () => {
			try {
				/* 只保留最近 400 条，避免无限增长 */
				statusStore.ranEver = statusStore.ranEver.slice(-400);
				statusStore.seen = statusStore.seen.slice(-400);
				statusStore.unreadDone = statusStore.unreadDone.slice(-400);
				window.localStorage.setItem(STATUS_KEY, JSON.stringify(statusStore));
			} catch {
				/* 存不进去不影响显示 */
			}
		};
		/* 上一轮的 running 集合：用来检测 true→false 的那一瞬间（任务刚跑完）。
		   只有那一瞬间才可能产生「未读完成」—— 平时查历史 running 是 false，判不出来。 */
		const prevRunning = { ids: new Set() };
		/**
		 * 读取宿主给某个会话渲染的状态点（StateDot 的 data-state）。
		 *
		 * 宿主在 `sidebar.session.row.leading` 插槽里渲染 `._dot_1i3xo_2`，
		 * 带 `data-state`：done（已完成/绿）/ warning（等待回答/橙）/ error（红）/ idle（灰）。
		 * 这是宿主自己的判定，插件直接复用，不再自己推 running/unread —— 两套并存会打架。
		 *
		 * @param sessionId - 会话 id。
		 * @returns data-state 字符串，取不到时返回空串。
		 */
		function hostStateOf(sessionId) {
			if (typeof sessionId !== "string" || sessionId === "") return "";
			try {
				const row = document.querySelector(`[data-row-key="session:${sessionId}"]`);
				if (row === null) return "";
				const dot = row.querySelector('[data-slot="sidebar.session.row.leading"] [data-state]')
					?? row.querySelector("[data-state]");
				if (dot === null) return "";
				const state = dot.getAttribute("data-state");
				return typeof state === "string" ? state : "";
			} catch {
				return "";
			}
		}

		/* statusStore 是普通对象，改它不会触发 React 重渲染。
		   用这个版本号做触发器：每次状态变化 +1，标签圆点才会跟着出现/消失。 */
		const statusVersion = { value: 0 };
		/* 上一轮抓到的宿主状态点签名，用于检测变化并刷新标签圆点。 */
		const hostStateSig = { value: "" };

		/**
		 * 直接清掉宿主给某个会话记的「完成未读」标记。
		 *
		 * 宿主 UiSession 里 `completionUnread` 是个普通 Set，`publishStatus()`
		 * 负责把它推给订阅者（侧栏的 StateDot 就读这个）。
		 * 插件自己渲染标签、不走宿主 mainView，所以宿主永远不知道该清谁 ——
		 * 与其伪造 mainView（会和宿主的 blank 会话抢 mainSessionId，导致
		 * 侧栏"新会话"行忽隐忽现），不如直接把这条清掉。
		 *
		 * @param sessionId - 已经被用户看到的会话。
		 */
		function clearHostUnread(sessionId) {
			if (typeof sessionId !== "string" || sessionId === "") return;
			try {
				const uiSession = SERVICES.ctx?.get?.("uiSession");
				if (uiSession === void 0 || uiSession === null) return;
				const set = uiSession.completionUnread;
				if (set instanceof Set && set.has(sessionId) === true) {
					set.delete(sessionId);
					if (typeof uiSession.publishStatus === "function") uiSession.publishStatus();
				}
			} catch {
				/* 宿主内部结构变了就放弃，不影响渲染 */
			}
		}

		function rememberNewSession(id) {
			if (typeof id !== "string" || id === "") return;
			pendingNew.id = id;
			pendingNew.at = Date.now();
		}

		function sessionListItems() {
			try {
				const snapshot = resolveSessions()?.list?.getSnapshot?.();
				if (Array.isArray(snapshot)) return snapshot;
				if (Array.isArray(snapshot?.items)) return snapshot.items;
				if (Array.isArray(snapshot?.sessions)) return snapshot.sessions;
				return [];
			} catch {
				return [];
			}
		}

		/** The newest session created within `withinMs` — the fallback when no id was captured. */
		function newestFreshSession(withinMs) {
			let best = null;
			let bestAt = 0;
			for (const item of sessionListItems()) {
				const id = typeof item === "string" ? item : (item?.id ?? item?.sessionId);
				if (typeof id !== "string" || id === "") continue;
				const stamp = Date.parse(item?.createdAt ?? item?.updatedAt ?? "") || 0;
				if (stamp > bestAt && Date.now() - stamp <= withinMs) {
					best = id;
					bestAt = stamp;
				}
			}
			return best;
		}

		/** Open a freshly created session as its own tab, keeping the others. */
		function openAsNewTab(sessionId) {
			if (typeof bridge.openTab === "function") {
				bridge.openTab(sessionId);
				return;
			}
			requestOpen(sessionId);
		}

		/**
		 * Put a freshly created session into the workspace after the host asked for
		 * the native panel. Sources, best first: the id captured from the host's
		 * create calls (or its `replaceMain`), the newest session that appeared in
		 * the list seconds ago, and finally a blank tab — a new-session click must
		 * never end in a workspace that silently dropped what the user asked for.
		 *
		 * Deliberately NOT used: the workspace selection. It is whatever row the
		 * sidebar happens to highlight, which is an OLD conversation — that made
		 * 「新建会话」 reopen some previous session instead of a blank one.
		 */
		function foldNewSession(attempt) {
			const replace = pendingReplace.on === true;
			const finish = (id) => {
				pendingReplace.on = false;
				if (replace === true && typeof bridge.replaceTab === "function") bridge.replaceTab(id);
				else openAsNewTab(id);
			};
			const fresh = Date.now() - pendingNew.at < 5000 ? pendingNew.id : null;
			if (typeof fresh === "string" && fresh !== "") {
				pendingNew.id = null;
				finish(fresh);
				return;
			}
			const appeared = newestFreshSession(12000);
			if (typeof appeared === "string" && appeared !== "") {
				finish(appeared);
				return;
			}
			/* The list may lag the creation by a tick, so retry briefly before
			   settling for a blank tab. */
			if (attempt < 6) {
				setTimeout(() => foldNewSession(attempt + 1), 120);
				return;
			}
			if (typeof bridge.blank === "function") {
				bridge.blank();
				return;
			}
			selectPanel(NATIVE_PANEL);
		}

		/**

		 * 切主面板（与 selectPanel 等价，但走的是 layout 的对外面）。

		 *

		 * 为什么不只用 selectPanel：那是插件内部包装，只在 layout.selectPanel 上；

		 * 而设置页/侧栏这些调用点分布在两处包装里。统一走这里，

		 * 保证 activePanelId 一定被设到宿主能识别的值上（侧栏选中态依赖它）。

		 */

		function panelSelect(panelId) {

			const layout = SERVICES.layout ?? service("layout");

			if (layout === void 0 || layout.panels === void 0) return;

			bridge.selfSelect = true;

			try {

				layout.panels.selectPanel(panelId);

			} catch (error) {

				console.warn("[split-view] panelSelect failed:", error);

			} finally {

				bridge.selfSelect = false;

			}

		}



		/** Switch the main panel without being mistaken for a sidebar click. */
		function selectPanel(panelId) {
			const layout = service("layout");
			if (layout === void 0) return;
			bridge.selfSelect = true;
			try {
				layout.selectPanel(panelId);
			} catch (error) {
				console.warn("[split-view] selectPanel failed:", error);
			} finally {
				bridge.selfSelect = false;
			}
		}

		/** Whatever is currently being dragged (session row from the tree, or a tab). */
		const drag = { sessionId: null, tab: null };

		/* 宿主「会话右键菜单」里的贡献项在 React 之外被 resolve，拿不到组件内的 state / apply，
		   所以留两个模块级指针：最近一次渲染的布局状态、以及写状态的 apply。 */
		let LIVE_STATE = null;
		let LIVE_APPLY = null;
		/* 宿主的会话右键菜单服务：必须从 ctx.inject(["contextMenus"]) 的授权 ctx 上取，
		   直接读 ctx.contextMenus 会报 cannot get property contextMenus without inject。 */
		let MENUS = null;

		/**
		 * Route "open this session" into the workspace, whatever the main panel is
		 * currently showing: a live workspace takes it directly, the settings page
		 * and the native panel go through the pending slot after switching over.
		 *
		 * `fallback` runs when the workspace still has not picked the click up a
		 * moment later. Swallowing a session click that then goes nowhere is the
		 * worst possible outcome — the app looks frozen — so the host's own open
		 * wins over silence.
		 */
		function requestOpen(sessionId, fallback) {
			if (typeof sessionId !== "string" || sessionId === "") return;
			if (bridge.open !== null && prefs.state.showSettings !== true) {
				bridge.open(sessionId);
				return;
			}
			pendingOpen.sessionId = sessionId;
			if (prefs.state.showSettings === true) prefs.update({ showSettings: false });
			selectPanel(NATIVE_PANEL);
			if (typeof fallback !== "function") return;
			setTimeout(() => {
				if (pendingOpen.sessionId !== sessionId) return;
				pendingOpen.sessionId = null;
				try {
					fallback();
				} catch (error) {
					console.warn("[split-view] could not fall back to the host:", error);
				}
			}, 800);
		}

		/**
		 * Tiny external store for the two persisted preferences, so the settings
		 * page, the sidebar entry and the workspace all stay in sync.
		 */
		const PREFS_KEY = "dsh-split-view:prefs:v1";

		/**
		 * 分割线 / 焦点指示线的配色。
		 *
		 * 为什么不用 --dsh-accent-color：实测宿主的根元素上**根本没有这个变量**
		 * （getComputedStyle 读出来是空串），所以以前每条 var(--dsh-accent-color,#4a8cf7)
		 * 全都落到备用值 #4a8cf7 —— 高饱和亮蓝（S=91%），在深色底上会“发光”。
		 *
		 * 配色依据 Radix Colors 深色色阶（专为深色界面设计、带对比度保证）推导：
		 * 统一取 L=67%（够亮），饱和度按色相气质给 48–62%（不艳），
		 * 相邻色相间隔 ≥38°，保证任意两色可分辨。
		 * 第一版用 L≈45-52% + 45% 透明度绘制，实际渲染对比只有 1.7-2.1，偏暗 —— 已废弃。
		 */
		const LINE_COLORS = [
			{ id: "graphite", name: "石墨灰", hex: "#a7aaaf" },
			{ id: "mist-blue", name: "雾蓝", hex: "#7dabd9" },
			{ id: "jade", name: "青绿", hex: "#82d3c8" },
			{ id: "grass", name: "草绿", hex: "#7dd989" },
			{ id: "violet", name: "藕紫", hex: "#a27fd7" },
			{ id: "rose", name: "雾玫", hex: "#d5819a" },
			{ id: "amber", name: "琥珀", hex: "#dfc377" }
		];
		const LINE_COLOR_IDS = LINE_COLORS.map((item) => item.id);
		const DEFAULT_LINE_COLOR = "graphite";

		/* 线宽档位。**只作用于分隔条、拖动预览虚线框、虚位标签边框**；
		   标签下方的焦点线固定 2px，不跟这个档位走（用户明确要求）。 */
		const LINE_WIDTHS = [
			{ id: "thin", name: "细", px: 1 },
			{ id: "normal", name: "标准", px: 2 },
			{ id: "bold", name: "粗", px: 3 },
			{ id: "heavy", name: "很粗", px: 4 }
		];
		const LINE_WIDTH_IDS = LINE_WIDTHS.map((item) => item.id);
		const DEFAULT_LINE_WIDTH = "normal";

		function lineWidthPx(id) {
			const found = LINE_WIDTHS.find((item) => item.id === id);
			return found !== undefined ? found.px : LINE_WIDTHS.find((item) => item.id === DEFAULT_LINE_WIDTH).px;
		}

		function lineColorHex(id) {
			const found = LINE_COLORS.find((item) => item.id === id);
			return found !== undefined ? found.hex : LINE_COLORS.find((item) => item.id === DEFAULT_LINE_COLOR).hex;
		}

		/* 分割条 / 预览框 / 焦点线的**不透明度**档位。
		   以前分隔条是硬编码 85%，只能改颜色不能改浓淡（2026-11-07 用户要求可调）。
		   默认 85% 与旧外观一致，升级后不会突变。 */
		const LINE_OPACITIES = [
			{ id: "faint", name: "很淡", alpha: 0.3 },
			{ id: "soft", name: "偏淡", alpha: 0.5 },
			{ id: "medium", name: "适中", alpha: 0.7 },
			{ id: "strong", name: "标准", alpha: 0.85 },
			{ id: "solid", name: "实色", alpha: 1 }
		];
		const LINE_OPACITY_IDS = LINE_OPACITIES.map((item) => item.id);

		/* 视图条（会话视图切换条）的显示位置。
		   off   = 不接管，沿用宿主默认（栏内没有视图切换条）
		   top   = 画在每栏正文上方
		   bottom= 画在每栏底部（输入框之下）
		   位置与「显示哪些视图」「什么顺序」都是独立设置，见 prefs.viewBar*。 */
		const VIEWBAR_PLACEMENTS = ["off", "top", "bottom"];
		const DEFAULT_VIEWBAR_PLACEMENT = "top";
		const DEFAULT_LINE_OPACITY = "strong";

		function lineAlpha(id) {
			const found = LINE_OPACITIES.find((item) => item.id === id);
			return found !== undefined ? found.alpha : LINE_OPACITIES.find((item) => item.id === DEFAULT_LINE_OPACITY).alpha;
		}

		/** 把 #rrggbb 换成带 alpha 的 rgba() —— 避免在 CSS 里做 calc 百分比插值。 */
		function withAlpha(hex, alpha) {
			const text = String(hex).replace("#", "");
			const r = parseInt(text.slice(0, 2), 16);
			const g = parseInt(text.slice(2, 4), 16);
			const b = parseInt(text.slice(4, 6), 16);
			const a = Math.max(0, Math.min(1, alpha));
			return `rgba(${r}, ${g}, ${b}, ${a})`;
		}
		/**
		 * 视图条（会话视图切换条）的默认配置。
		 *
		 * viewBarPlacement  off / top / bottom —— 在哪画；off = 完全不动宿主自己的行为
		 * viewBarOrder      自定义顺序（存 id 列表，没列到的排在后面按宿主 order）
		 * viewBarHidden     用户关掉的视图 id —— 这些不进主行，全部收进「…」折叠菜单
		 *
		 * 这几项都是「每个用户自己调」的，所以老用户第一次升级拿到的是这一份默认。
		 */
		function DEFAULTS() {
			return {
				enabled: true,
				showSettings: false,
				showInSidebar: true,
				titlebarDrag: true,
				lineColor: DEFAULT_LINE_COLOR,
				lineWidth: DEFAULT_LINE_WIDTH,
				lineOpacity: DEFAULT_LINE_OPACITY,
				dblclickClose: true,
				viewBarPlacement: DEFAULT_VIEWBAR_PLACEMENT,
				viewBarOrder: [],
				viewBarHidden: [],
				hostBar: true
			};
		}

		/** 只留下字符串 id，去重保序 —— 存坏了的 JSON 不该把设置页搞乱。 */
		function cleanIdList(value) {
			if (!Array.isArray(value)) return [];
			const out = [];
			for (const item of value) {
				if (typeof item === "string" && item !== "" && out.indexOf(item) < 0) out.push(item);
			}
			return out;
		}

		const prefs = {
			state: { enabled: true, showSettings: false, showInSidebar: true },
			listeners: new Set(),
			read() {
				try {
					const raw = window.localStorage.getItem(PREFS_KEY);
					/* First run: the workspace is on by default, so the split view is
					   what the app opens with instead of a panel the user never picks. */
					if (raw === null) return DEFAULTS();
					const parsed = JSON.parse(raw);
					/* The settings page is a transient view, never a boot destination:
					   restoring it is what made "click 多栏" feel like the only way in.
					   A profile that was parked on it never got the switch flipped, so
					   treat it as enabled rather than bouncing the user back there. */
					const parked = parsed?.showSettings === true;
					return {
						enabled: parsed?.enabled === true || parked,
						showSettings: false,
						/* 侧边栏是否显示本插件入口：默认显示。 */
						showInSidebar: parsed?.showInSidebar !== false,
						titlebarDrag: parsed?.titlebarDrag !== false,
						lineColor: LINE_COLOR_IDS.indexOf(parsed?.lineColor) >= 0 ? parsed.lineColor : DEFAULT_LINE_COLOR,
						lineWidth: LINE_WIDTH_IDS.indexOf(parsed?.lineWidth) >= 0 ? parsed.lineWidth : DEFAULT_LINE_WIDTH,
						lineOpacity: LINE_OPACITY_IDS.indexOf(parsed?.lineOpacity) >= 0 ? parsed.lineOpacity : DEFAULT_LINE_OPACITY,
						dblclickClose: parsed?.dblclickClose !== false,
						viewBarPlacement: VIEWBAR_PLACEMENTS.indexOf(parsed?.viewBarPlacement) >= 0 ? parsed.viewBarPlacement : DEFAULT_VIEWBAR_PLACEMENT,
						viewBarOrder: cleanIdList(parsed?.viewBarOrder),
						viewBarHidden: cleanIdList(parsed?.viewBarHidden),
						hostBar: parsed?.hostBar !== false
					};
				} catch {
					return DEFAULTS();
				}
			},
			write(next) {
				prefs.state = next;
				try {
					window.localStorage.setItem(
						PREFS_KEY,
						JSON.stringify({
							enabled: next.enabled === true,
							showInSidebar: next.showInSidebar !== false,
							lineColor: LINE_COLOR_IDS.indexOf(next.lineColor) >= 0 ? next.lineColor : DEFAULT_LINE_COLOR,
							lineWidth: LINE_WIDTH_IDS.indexOf(next.lineWidth) >= 0 ? next.lineWidth : DEFAULT_LINE_WIDTH,
							lineOpacity: LINE_OPACITY_IDS.indexOf(next.lineOpacity) >= 0 ? next.lineOpacity : DEFAULT_LINE_OPACITY,
							dblclickClose: next.dblclickClose !== false,
							viewBarPlacement: VIEWBAR_PLACEMENTS.indexOf(next.viewBarPlacement) >= 0 ? next.viewBarPlacement : DEFAULT_VIEWBAR_PLACEMENT,
							viewBarOrder: cleanIdList(next.viewBarOrder),
							viewBarHidden: cleanIdList(next.viewBarHidden),
							hostBar: next.hostBar !== false
						})
					);
				} catch {
					/* storage may be unavailable */
				}
				prefs.listeners.forEach((listener) => {
					try {
						listener();
					} catch {
						/* ignore a broken subscriber */
					}
				});
			},
			update(patch) {
				prefs.write({ ...prefs.state, ...patch });
			},
			subscribe(listener) {
				prefs.listeners.add(listener);
				return () => prefs.listeners.delete(listener);
			},
			getSnapshot() {
				return prefs.state;
			}
		};
		prefs.state = prefs.read();

		/**
		 * 把「当前是否停在设置页」同步到 `<html data-dsv-settings>`。
		 *
		 * 侧栏入口的选中态靠它决定（见 CSS）：
		 * 在设置页 → 保留宿主高亮；在工作区 → 中和掉。
		 * 宿主的 activePanelId 认不出这个区别（插件的 panel id 恒等于主面板 id），
		 * 只能由插件自己广播这一位。
		 */
		function syncSettingsFlag() {
			try {
				document.documentElement.setAttribute("data-dsv-settings", prefs.state.showSettings === true ? "1" : "0");
			} catch {
				/* non-web host */
			}
		}

		/**
		 * 让 `prefs.showSettings` 始终等于「当前面板是不是我们的设置页」。
		 *
		 * 现在设置页是 main 槽里 key=PANEL_ID 的真面板，宿主自己会把
		 * activePanelId 设成它并给侧栏图标上选中态。但插件内部还有不少地方
		 * 读 prefs.showSettings（比如 requestOpen 判断"停在设置页"），
		 * 两边必须一致，否则行为会分叉。以 panelInfo 为唯一真源往 prefs 镜像。
		 */
		function mirrorSettingsFromPanel() {
			try {
				const layout = SERVICES.layout ?? service("layout");
				SERVICES.layout = layout;
				if (layout === void 0 || layout.panelInfo === void 0) return;
				const active = layout.panelInfo.getSnapshot()?.activePanelId ?? null;
				const shouldShow = active === PANEL_ID;
				if (prefs.state.showSettings !== shouldShow) prefs.update({ showSettings: shouldShow });
			} catch {
				/* 忽略 */
			}
		}
		syncSettingsFlag();
		prefs.subscribe(syncSettingsFlag);
		/* 把解析后的完整 prefs 立即写回一次。
		   老用户存的 JSON 里根本没有 showInSidebar 这个键 —— 不写回的话，
		   每次 read() 都用默认 true 覆盖，导致「关闭侧栏入口」改了等于没改。 */
		prefs.write(prefs.state);

		/**
		 * 给侧栏的会话行打标记，恢复「哪个是焦点会话、哪个只是已打开」的区分。
		 *
		 * 背景：插件接管 selectPanel 之后，宿主不再把行标成选中（实测所有行
		 * aria-selected=false、背景透明），于是侧栏看起来全一样。这里自己算：
		 *   data-dsv-row="focus"  → 焦点栏当前激活标签对应的会话
		 *   data-dsv-row="open"   → 其它栏里已打开的会话
		 * 用轮询 + MutationObserver 双保险（宿主会重渲染列表）。
		 */
		/**
		 * 给侧栏的会话行打「焦点 / 已打开」标记 —— **不依赖 React 生命周期**。
		 *
		 * 为什么必须抽成独立函数：这段逻辑原来只活在 `WorkspaceRoot` 的
		 * `useSidebarRowMarks` 里。用户点侧栏「多栏视图」入口 → main 槽切到设置页
		 * → `WorkspaceRoot` 卸载 → hook 清理时把所有 `data-dsv-row` 抹掉、也不再补
		 * `_selected` class → **会话列表当场变回官方裸形态**（用户原话「割裂感很强」）。
		 * 而插件的分栏功能明明还开着。
		 *
		 * 现在 apply 层有一个常驻循环（`startSidebarMarks`）始终在跑这一段，
		 * 不管当前在看工作区还是设置页。
		 *
		 * 幂等：重复调用只是重复设置同样的属性，没有副作用。
		 */
		function paintSidebarRows(state) {
			const sessions = resolveSessions();
			let snap;
			try {
				snap = sessions?.list?.getSnapshot?.();
			} catch {
				snap = void 0;
			}
			const runningIds = new Set();
			for (const row of sessionRows(snap)) {
				if (row?.running === true && typeof row.id === "string") runningIds.add(row.id);
			}
			prevRunning.ids = new Set(runningIds);
			const panes = Array.isArray(state?.panes) ? state.panes : [];
			const focusPane = panes.find((pane) => pane.id === state?.focusPaneId) ?? panes[0];
			const focusTab = focusPane === void 0 ? void 0 : focusPane.tabs.find((tab) => tab.id === focusPane.activeTabId) ?? focusPane.tabs[0];
			const focusSession = focusTab?.sessionId ?? null;
			if (typeof focusSession === "string") clearHostUnread(focusSession);
			const openSessions = new Set();
			for (const pane of panes) {
				for (const tab of pane.tabs) {
					if (typeof tab.sessionId === "string") openSessions.add(tab.sessionId);
				}
			}
			for (const row of document.querySelectorAll('[data-row-key^="session:"]')) {
				const id = (row.getAttribute("data-row-key") ?? "").slice("session:".length);
				const mark = id !== "" && id === focusSession ? "focus" : openSessions.has(id) ? "open" : "";
				if (mark === "") {
					if (row.getAttribute("data-dsv-row") !== null) row.removeAttribute("data-dsv-row");
				} else if (row.getAttribute("data-dsv-row") !== mark) {
					row.setAttribute("data-dsv-row", mark);
				}
				const hostSelected = row.className.split(/\s+/).some((c) => c.endsWith("_selected"));
				if (mark === "focus" && !hostSelected) {
					const base = row.className.split(/\s+/).find((c) => c.endsWith("_sessionRow"));
					if (base !== void 0) row.classList.add(base.replace(/_sessionRow$/, "_selected"));
				} else if (mark !== "focus" && hostSelected) {
					for (const cls of Array.from(row.classList)) {
						if (cls.endsWith("_selected")) row.classList.remove(cls);
					}
				}
			}
		}

		/**
		 * 常驻循环：让侧栏标记不随面板切换消失。
		 * 读 `window.__dsvState`（WorkspaceRoot 每次 state 变化写一份）；
		 * WorkspaceRoot 卸载后这个引用仍然在，所以设置页里也能正确标记。
		 * 冷启动时它还没写 → 回退到 localStorage（readState）。
		 */
		function startSidebarMarks() {
			let scheduled = false;
			const tick = () => {
				scheduled = false;
				/* 插件关掉后必须**停手并清掉标记**，否则会话列表还带着插件的高亮，
				   但主区域已经还给宿主了 —— 两边对不上，用户看起来就是「关不掉」。 */
				if (prefs.state.enabled !== true) {
					for (const row of document.querySelectorAll("[data-dsv-row]")) row.removeAttribute("data-dsv-row");
					for (const row of document.querySelectorAll('[data-row-key^="session:"]')) {
						for (const cls of Array.from(row.classList)) {
							if (cls.endsWith("_selected")) row.classList.remove(cls);
						}
					}
					return;
				}
				try {
					paintSidebarRows(window.__dsvState ?? readState());
				} catch {
					/* 忽略 */
				}
			};
			/* 心跳：处理「状态自己变了」（焦点栏换标签、切栏等），这类变化不伴随 DOM 结构变动。 */
			setInterval(tick, 700);
			/* 即时：宿主重渲染侧栏、行节点被重建时，新节点上没有标记 ——
			   在同一个微任务里补，用户看不到裸形态那一帧。
			   只观察 childList（节点增删）；**不观察 attributes**：
			   我们自己在 paintSidebarRows 里写 data-dsv-row，观察它会造成自触发。 */
			const attach = () => {
				const tree = document.querySelector('[data-slot="sidebar"]');
				if (tree === null || typeof MutationObserver !== "function") return false;
				const observer = new MutationObserver(() => {
					if (scheduled) return;
					scheduled = true;
					queueMicrotask(tick);
				});
				observer.observe(tree, { childList: true, subtree: true });
				return true;
			};
			if (!attach()) {
				/* 侧栏可能还没挂载，稍后重试几次。 */
				let tries = 0;
				const retry = setInterval(() => {
					if (attach() || ++tries > 40) clearInterval(retry);
				}, 500);
			}
		}

		function useSidebarRowMarks(state, sessions, bumpStatus) {
			/* 运行中状态来自宿主 session 列表的 row.running。
			   ⚠️ 必须在 compute 里**每次现读 getSnapshot**，不能依赖 useSessionList 的订阅：
			   实测宿主的 list.update / list.set 都不触发 subscribe 回调（2026-11-07 验证），
			   靠订阅会漏掉 running 变化 → 绿点不出现。700ms 轮询读快照最稳。 */
			const runningIdsRef = react.useRef(new Set());
			react.useEffect(() => {
				const compute = () => {
					/* 本轮是否改动了 statusStore —— 改了就要通知 React 重渲染。 */
					let changed = false;
					const runningIds = (() => {
						const set = new Set();
						try {
							const snap = sessions?.list?.getSnapshot?.();
							for (const row of sessionRows(snap)) {
								if (row?.running === true && typeof row.id === "string") set.add(row.id);
							}
						} catch {
							/* 拿不到就当没有运行中的会话 */
						}
						runningIdsRef.current = set;
						return set;
					})();
					const focusPane = state.panes.find((pane) => pane.id === state.focusPaneId) ?? state.panes[0];
					const focusTab = focusPane === void 0 ? void 0 : focusPane.tabs.find((tab) => tab.id === focusPane.activeTabId) ?? focusPane.tabs[0];
					const focusSession = focusTab?.sessionId ?? null;
					/* 用户在看着这个会话 → 让宿主把它的「完成未读」绿点清掉。
					   不能伪造 mainView（会和宿主 blank 会话抢 mainSessionId，
					   导致侧栏"新会话"行忽有忽无），直接清那个 Set 最干净。 */
					if (typeof focusSession === "string") clearHostUnread(focusSession);
					const openSessions = new Set();
					for (const pane of state.panes) {
						for (const tab of pane.tabs) {
							if (typeof tab.sessionId === "string") openSessions.add(tab.sessionId);
						}
					}
					/* 记录本轮 running 集合，供标签页的状态点判断使用。 */
					prevRunning.ids = new Set(runningIds);
					/* 宿主状态点（done/warning/error/idle）可能随时变化 —— 它不在 React 数据流里，
					   每轮抓一次签名，变了就 bump 让标签页圆点跟着刷新。 */
					let hostSig = "";
					for (const node of document.querySelectorAll('[data-row-key^="session:"] [data-state]')) {
						const rowEl = node.closest('[data-row-key^="session:"]');
						if (rowEl === null) continue;
						hostSig += `${rowEl.getAttribute("data-row-key")}:${node.getAttribute("data-state")};`;
					}
					if (hostSig !== hostStateSig.value) {
						hostStateSig.value = hostSig;
						changed = true;
					}
					for (const row of document.querySelectorAll('[data-row-key^="session:"]')) {
						const id = (row.getAttribute("data-row-key") ?? "").slice("session:".length);
						/* 会话状态点交给宿主（StateDot：done/warning/error/idle），
						   插件只管"哪个会话在焦点 / 哪个已打开"。 */
						const mark = id !== "" && id === focusSession ? "focus" : openSessions.has(id) ? "open" : "";
						if (mark === "") {
							if (row.getAttribute("data-dsv-row") !== null) row.removeAttribute("data-dsv-row");
						} else if (row.getAttribute("data-dsv-row") !== mark) {
							row.setAttribute("data-dsv-row", mark);
						}
						/* 同时挂上宿主自己的 selected class —— 它本来就有
						   `.sessionRow.selected{background:var(--dsw-alias-interactive-bg-hover)}` 这条规则，
						   只是插件接管 selectPanel 后不再有人加这个 class。用宿主的规则更贴合原生观感。 */
						const hostSelected = row.className.split(/\s+/).some((c) => c.endsWith("_selected"));
						if (mark === "focus" && !hostSelected) {
							const base = row.className.split(/\s+/).find((c) => c.endsWith("_sessionRow"));
							if (base !== void 0) row.classList.add(base.replace(/_sessionRow$/, "_selected"));
						} else if (mark !== "focus" && hostSelected) {
							for (const cls of Array.from(row.classList)) {
								if (cls.endsWith("_selected")) row.classList.remove(cls);
							}
						}
					}
					/* 状态真的变了 → 让 React 重渲染一次，标签圆点才会跟着更新。 */
					if (changed === true && typeof bumpStatus === "function") bumpStatus();
				};
				compute();
				const timer = window.setInterval(compute, 700);
				let observer = null;
				const tree = document.querySelector('[data-slot="sidebar"]');
				if (tree !== null && typeof MutationObserver === "function") {
					observer = new MutationObserver(compute);
					observer.observe(tree, { childList: true, subtree: true });
				}
				return () => {
					window.clearInterval(timer);
					if (observer !== null) observer.disconnect();
					/* ⚠️ 不要在这里抹 data-dsv-row。
					   之前这一行是 for(...) row.removeAttribute("data-dsv-row")：
					   点侧栏「多栏视图」→ main 槽切设置页 → WorkspaceRoot 卸载 →
					   标记被全部抹掉 → 会话列表当场变回官方裸形态，等常驻循环
					   （startSidebarMarks）下一拍才补回来 —— 用户看到「先变官方、
					   再变回来」那一下闪。标记归属权归 apply 层常驻循环。 */
				};
			/* runningIds 现在在 compute 内部现读，不再是外部变量；
			   sessions 变了要重挂（拿到新的 list 引用）。 */
			}, [state, sessions]);
		}

		function usePrefs() {
			return react.useSyncExternalStore(prefs.subscribe, prefs.getSnapshot, prefs.getSnapshot);
		}
		//#endregion

		//#region styles
		const CSS = `
.dsv-root{display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0;position:relative;overflow:hidden}
/* Every pane carries its own strip, so the strips line up with the columns below
   them while the whole row still sits on the host's 44px toolbar line. */
.dsv-paneheader{display:flex;align-items:center;gap:2px;flex:0 0 auto;height:44px;padding:0 8px;position:fixed;top:0;left:0;width:0;z-index:60;box-sizing:border-box;app-region:drag;-webkit-app-region:drag;/* 只有最右一栏需要给窗口按钮让位（见下面的 :last-child 规则）。以前这里给**每一栏**都扣掉 137px，导致窄栏的标签条只剩几十像素、标签被截断。 */;border-bottom:1px solid var(--dsh-border-color,rgba(128,128,128,.22));overflow:hidden;/* 浮到窗口最顶端那一行（与宿主顶部工具栏同高）：宿主容器会裁溢出，负 margin 抬不上去，fixed 不受祖先 overflow 影响。left/width 由 PaneHeader 里的 ResizeObserver 同步。 */}
/* max-width 给右侧留出固定的可拖窗口区（44px）：
   否则标签一多就把整条占满，那一栏的空白处没有 app-region:drag 的像素，
   用户拖窗口 / 双击最大化就完全失效（栏 0 曾 spacer 宽度为 0）。 */
/* 不横向滚动：滚动条意味着后面的标签被裁掉（圆角/蓝条被切断）。
   标签自己会收缩（min-width:0 + flex-shrink:1），保证全部可见。 */
/* flex:0 1 auto —— 宽度由内容（标签）决定，**不要 flex:1**，
   否则标签少时 strip 会撑满整条，把 + 按钮推到很远的右边。
   max-width 只防极端溢出；精确的可用宽度由 JS 算好写进标签的 width，
   两边各扣一次 44px 会导致「JS 以为能放 92px、CSS 只给 24px」而溢出。 */
.dsv-tabs{display:flex;align-items:center;gap:2px;flex:0 1 auto;min-width:0;overflow:hidden}
.dsv-tabs::-webkit-scrollbar{height:0}
.dsv-paneheader[data-drop="1"]{outline:var(--dsv-line-w,2px) dashed var(--dsv-line,#a7aaaf);outline-offset:calc(-1 * var(--dsv-line-w,2px))}
.dsv-panes{display:flex;flex-direction:row;flex:1 1 auto;min-width:0;min-height:0;overflow:hidden}
.dsv-pane{display:flex;flex-direction:column;min-width:0;min-height:0;position:relative;overflow:hidden;background:var(--dsh-surface-color,transparent);padding-top:calc(var(--dsv-head-h,45px) - var(--dsv-host-offset,0px))}
.dsv-pane[data-drop="1"]{outline:var(--dsv-line-w,2px) dashed var(--dsv-line,#a7aaaf);outline-offset:calc(-1 * var(--dsv-line-w,2px))}
.dsv-pane[data-focus="1"] .dsv-tab[data-active="1"]{background:var(--dsh-surface-raised-color,rgba(128,128,128,.14))}
.dsv-pane[data-drop-side="left"]{box-shadow:inset var(--dsv-line-w,2px) 0 0 var(--dsv-line,#a7aaaf)}
.dsv-pane[data-drop-side="right"]{box-shadow:inset calc(-1 * var(--dsv-line-w,2px)) 0 0 var(--dsv-line,#a7aaaf)}
/* 拖动悬停预览：松手前就告诉用户会发生什么 */
.dsv-droppreview{position:absolute;top:0;bottom:0;z-index:6;pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;width:50%;background:color-mix(in srgb,var(--dsv-line,#a7aaaf) 12%,transparent);outline:var(--dsv-line-w,2px) dashed var(--dsv-line,#a7aaaf);outline-offset:calc(-1 * var(--dsv-line-w,2px))}
.dsv-droppreview[data-side="left"]{left:0}
.dsv-droppreview[data-side="right"]{right:0}
.dsv-droppreview-mini{display:flex;align-items:center;gap:6px;padding:8px 10px;border-radius:8px;background:var(--dsh-surface-raised-color,rgba(20,20,24,.82));box-shadow:0 2px 10px rgba(0,0,0,.35)}
.dsv-droppreview-mini span{display:block;height:22px;border-radius:3px;opacity:.45;background:var(--dsh-border-strong-color,rgba(255,255,255,.5))}
.dsv-droppreview-mini span[data-new="1"]{opacity:1;background:var(--dsv-line,#a7aaaf)}
.dsv-droppreview-label{font-size:11px;font-weight:600;padding:5px 10px;border-radius:999px;background:var(--dsh-surface-raised-color,rgba(18,18,22,.92));color:var(--dsh-text-strong-color,#e8eefc);box-shadow:0 2px 10px rgba(0,0,0,.4)}
.dsv-tab[data-ghost="1"]{pointer-events:none;opacity:.85;border:var(--dsv-line-w,2px) dashed var(--dsv-line,#a7aaaf);background:color-mix(in srgb,var(--dsv-line,#a7aaaf) 16%,transparent)}
.dsv-divider[data-preview="1"]::after{content:"松手：插到这一栏的位置";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);white-space:nowrap;padding:4px 8px;border-radius:6px;font-size:11px;font-weight:600;background:var(--dsh-surface-raised-color,rgba(20,20,24,.9));color:var(--dsh-text-strong-color,#e8eefc);box-shadow:0 2px 10px rgba(0,0,0,.4);pointer-events:none;z-index:7}
/* 视图切换条：宽窄由容器决定，窄了就靠 JS 收进「…」，这里只管排版。 */
.dsv-slotitem{display:inline-flex;align-items:center;min-width:0;flex:0 0 auto}
.dsv-hostbar{flex:0 0 auto;display:flex;align-items:center;gap:8px;min-width:0;min-height:32px;padding:0 10px;position:relative;z-index:3;overflow:hidden}
/* 不再强制占位：宿主 lineage 槽当前渲不出内容，写死 64px 就变成一片空白。 */
.dsv-hostbar-left{display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;flex:0 1 auto}
.dsv-hostbar-right{display:flex;align-items:center;gap:6px;margin-left:auto;flex:0 0 auto}
.dsv-hostbar .dsv-slotrow{display:flex;align-items:center;gap:6px;min-width:0}
/* 会话标题：宿主 lineage 槽渲染不出内容时的兜底（也是正常时期的唯一标题来源）。 */
.dsv-hostbar-title{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;max-width:260px;opacity:.95}
.dsv-hostbar [data-slot-place="corner"]{margin-left:2px}
/* ⚠️ 右栏开关常驻：**绝对定位到本栏右上角**，脱离 flex 流。
   原因（2026-11-08 实测）：右侧按钮组是 flex:0 0 auto，不会压缩；
   某个栏窄下来时它的内容宽度可以超过整条 hostbar（实测 pane 宽 407，
   右侧组要 428），最后那个「打开右侧边栏」被推到栏外，被
   .dsv-paneheader 的 overflow:hidden 裁掉 —— 用户看到的就是「右分栏的
   侧边栏按钮没有显示」。官方原版无论怎么缩这个按钮都在，次要按钮才折叠。
   绝对定位后它永远贴着本栏右边缘，不受右侧组总宽影响。 */
/* 右栏开关**回到正常流**，靠 order:99 排在最后。
   之前用 position:absolute;right:10px 是为了「窄栏时不被裁」，实测反而更糟：
   它的包含块被算成 287px 宽，按钮跑到「更多操作」左边、三个按钮叠在一起
   （用户实测 2026-11-08）。回到流内 + order 最后，位置永远在按钮组最右边，
   不会和其它按钮重叠；空间不够时由 .dsv-hostbar-right 自己裁内部内容，
   这一颗始终完整。 */
.dsv-hostbar [data-slot-place="corner"]{flex:0 0 auto;order:99;margin:0 0 0 8px;z-index:2}
/* 右侧按钮组：给角落那个常驻按钮让出位置，超出部分自己裁掉，
   不要溢出到相邻栏上（溢出会画到隔壁栏里，看起来像串栏）。 */
/* Corner 是绝对定位、包含块是 .dsv-hostbar，所以这里的 overflow 裁不到它。 */
/* 按钮组限宽：窄栏时不再无限往外长，超出的按钮裁掉，
   同时被收进「更多」菜单（见 CollapsedActions）—— 功能不丢。
   用户口径 2026-11-08：选方案 B「窄栏时次要按钮收进更多菜单」。 */
.dsv-hostbar-right{flex:0 0 auto;min-width:0;overflow:hidden}
/* 视图切换条放进 hostbar 后：占中间剩余空间，一行放不下时整块换到第二行。
   min-width 是「最小间隔」的保障 —— 再窄也不让它和标题/按钮贴脸。 */
/* 视图切换条在宿主会话头这一行里：
   顺序是 标题区 → 切换条 → 按钮区，按钮区 flex:0 0 auto 永不被压；
   空间不够时先压切换条（放不下的标签自动收进「…」菜单，见 ViewBar 的 fitCount），
   再压标题区。这样「标准模式 / 子智能体 / 右栏按钮」永远在原位，
   不会像 flex-wrap 那样被挤到第二行去。 */
/* flex:1 1 auto = 吃掉「标题」和「按钮组」之间**全部剩余空间**。
   原来写 0 1 auto（只缩不长），结果它只拿到 min-width 那点宽度，
   左边一大片空白、标签全被挤进「⋯」（用户实测「根本没靠左排列，明明有空间」）。 */
/* 一行模式下切换条拿**完整宽度**、不压缩：能走到这里说明 inline 判据已经
   确认「标题 + 切换条完整 + 按钮组最小宽」都放得下，所以它不该再被挤。
   压缩它 = 明明有空间却提前折叠标签（用户反复指出的那个问题）。 */
.dsv-hostbar .dsv-viewbar{flex:0 0 auto;padding:0 4px;border:0;min-height:0;background:transparent}
.dsv-viewbar{flex:0 0 auto;display:flex;align-items:center;min-width:0;position:relative;padding:0 10px;background:transparent}
.dsv-viewbar[data-placement="top"]{border-bottom:.5px solid var(--dsw-alias-border-l3,transparent);min-height:32px}
.dsv-viewbar[data-placement="bottom"]{border-top:.5px solid var(--dsw-alias-border-l3,transparent);min-height:32px}
.dsv-viewtabs{display:flex;align-items:center;gap:14px;min-width:0;flex:1 1 auto;overflow:hidden;position:relative}
.dsv-vtab{flex:0 0 auto;background:0 0;border:none;cursor:pointer;color:var(--dsw-alias-label-tertiary,#9aa0a6);font-size:13px;font-weight:500;line-height:16px;padding:6px 0;position:relative;white-space:nowrap;font-family:inherit}
.dsv-vtab:hover{color:var(--dsw-alias-label-secondary,#c2c7cc)}
.dsv-vtab[data-active="1"]{color:var(--dsw-alias-state-business-primary,#4a8cf7)}
.dsv-vtab[data-active="1"]::after{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;border-radius:2px;background:var(--dsw-alias-state-business-primary,#4a8cf7)}
.dsv-vmore{flex:0 0 auto;width:26px;height:22px;display:flex;align-items:center;justify-content:center;background:0 0;border:none;border-radius:4px;cursor:pointer;color:var(--dsw-alias-label-secondary,#9aa0a6);font-size:14px;line-height:1;margin-left:14px}
.dsv-vmore:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.dsv-vmore[data-active="1"]{color:var(--dsw-alias-state-business-primary,#4a8cf7)}
.dsv-vmenu{position:absolute;z-index:40;min-width:180px;max-width:280px;padding:6px;border-radius:8px;background:var(--dsw-alias-bg-elevated,#242528);border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.1));box-shadow:0 8px 24px rgba(0,0,0,.4)}
.dsv-viewbar[data-placement="top"] .dsv-vmenu{top:100%;left:10px}
.dsv-viewbar[data-placement="bottom"] .dsv-vmenu{bottom:100%;left:10px}
.dsv-vmenu-head{font-size:11px;opacity:.55;padding:4px 8px 6px}
.dsv-vmenu-item{display:flex;align-items:center;gap:6px;width:100%;background:0 0;border:none;border-radius:6px;cursor:pointer;color:var(--dsw-alias-label-primary,#e8e8e8);font-size:13px;padding:7px 8px;text-align:left;font-family:inherit}
.dsv-vmenu-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.dsv-vmenu-item[data-active="1"]{color:var(--dsw-alias-state-business-primary,#4a8cf7)}
.dsv-vmenu-check{width:12px;flex:0 0 auto;font-size:11px}
.dsv-vmenu-label{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsv-viewempty{font-size:12px;opacity:.5}

.dsv-placement{min-width:56px;justify-content:center}
.dsv-viewlist{display:flex;flex-direction:column;gap:2px;margin-top:4px}
.dsv-viewlist-empty{font-size:12px;opacity:.5;padding:8px 2px}
.dsv-viewrow{display:flex;align-items:center;gap:10px;padding:6px 4px;border-radius:6px}
.dsv-viewrow:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.04))}
.dsv-viewrow[data-hidden="1"]{opacity:.5}
.dsv-viewcheck{flex:0 0 auto;width:16px;height:16px;border-radius:4px;border:1.5px solid var(--dsw-alias-label-tertiary,#8b8b90);background:0 0;cursor:pointer;position:relative;padding:0}
.dsv-viewcheck[data-on="1"]{border-color:var(--dsw-alias-state-business-primary,#4a8cf7);background:var(--dsw-alias-state-business-primary,#4a8cf7)}
.dsv-viewcheck[data-on="1"]::after{content:"";position:absolute;left:4px;top:1px;width:5px;height:9px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
.dsv-viewname{flex:0 0 auto;font-size:13px;color:var(--dsw-alias-label-primary,#e8e8e8)}
.dsv-viewid{flex:1 1 auto;min-width:0;font-size:11px;opacity:.45;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,monospace}
.dsv-viewmove{flex:0 0 auto;display:flex;gap:2px}
.dsv-viewarrow{width:22px;height:22px;border-radius:4px;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.12));background:0 0;color:var(--dsw-alias-label-secondary,#c2c7cc);cursor:pointer;font-size:12px;line-height:1;padding:0}
.dsv-viewarrow:hover:enabled{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}
.dsv-viewarrow:disabled{opacity:.25;cursor:default}
.dsv-linkbtn{align-self:flex-start;background:0 0;border:none;color:var(--dsw-alias-state-business-primary,#4a8cf7);cursor:pointer;font-size:12px;padding:8px 2px;font-family:inherit}
.dsv-linkbtn:hover{text-decoration:underline}

.dsv-statusbar{display:flex;align-items:center;justify-content:center;gap:16px;flex:0 0 auto;height:30px;padding:0 12px;font-size:11px;line-height:1;border-top:1px solid var(--dsh-border-color,rgba(128,128,128,.18));white-space:nowrap;overflow:hidden}
.dsv-statusbar .dsv-stat{display:flex;align-items:center;gap:4px;flex:0 0 auto;position:relative;opacity:.7}
.dsv-statusbar .dsv-stat + .dsv-stat::before{content:"·";position:absolute;left:-10px;opacity:.45}
.dsv-statusbar .dsv-stat-label{opacity:.6}
/* 会话名靠最左；统计行整体居中（用户口径 2026-11-07） */
/* ⚠️ flex:0 0 auto —— 统计容器**不许收缩**。
   视图条放到底栏左侧后（prefs.viewBarPlacement = "bottom"），底栏是 space-between：
   左视图条、右统计。统计容器原来写 flex:0 1 auto（可收缩），于是它被压到几十像素，
   里面的宿主行跟着 ellipsis，最后只剩个尾数（用户实测 2026-11-08：底栏右边一小块还带省略号，
   中间 750px 空白）。不收缩 + 宿主行按内容宽（见 .dsv-dockhost > *）才显示得完整。 */
.dsv-statusbar .dsv-statgroup{display:flex;align-items:center;justify-content:center;gap:16px;min-width:0;flex:0 0 auto;max-width:100%}
/* 视图切换条在「底部」时：切换条占底栏左侧，统计信息整体靠右（space-between）。
   在「顶部」时保持原样：统计信息居中。 */
.dsv-statusbar[data-vb="bottom"]{justify-content:space-between}
.dsv-statusbar .dsv-vb-left{display:flex;align-items:center;min-width:0;flex:0 1 60%;max-width:60%;overflow:hidden;margin-right:12px}
/* flex:1 1 auto + width:100% 是必须的：.dsv-viewbar 自己会根据容器宽度决定
   放得下几个标签，如果它的宽度又由标签撑开，就形成循环依赖 → 永远收敛到 1 个。 */
.dsv-statusbar .dsv-vb-left .dsv-viewbar{min-height:0;height:100%;padding:0;border:0;background:transparent;flex:1 1 auto;width:100%;min-width:0}
/* 间隔用宿主默认的 14px：2px 时几个中文标签会连成一片（用户实测「间隔太小」）。 */
.dsv-statusbar .dsv-vb-left .dsv-viewtabs{gap:14px}
/* 标签高度必须让出底栏的 padding：原来 22px + padding:6px 会顶出 30px 的底栏，
   看起来就是「文字溢出了」。这里 padding 归零、line-height 吃掉整个底栏高度。 */
.dsv-statusbar .dsv-vb-left .dsv-vtab{height:30px;line-height:30px;padding:0}

/* 宿主原生统计行（可点击的费用明细 / 上下文占用等）整行搬进来，保留它的按钮与事件 */
.dsv-dockhost{display:flex;align-items:center;justify-content:center;gap:16px;min-width:0;overflow:hidden}
/* 宿主那一行按**内容宽**排版，且不许被 max-width:100% 收缩。
   宿主行自己是 flex + space-between（左统计、右上下文%），宽度一旦由父级 auto 宽度决定，
   max-width:100% 就形成循环，浏览器收到 min-content，于是每段各自 ellipsis。
   width:max-content + max-width:none 把这个循环打断。 */
.dsv-dockhost > *{flex:0 0 auto;min-width:0;max-width:none;width:max-content}
/* 宿主原生会话头（标题+模式/费用/子智能体 chips+对话·轨迹·上下文 标签页）逐栏渲染 */
.dsv-sessionhead{flex:0 0 auto;min-width:0;overflow:hidden}
/* 非焦点栏整体压暗一档：一眼能看出焦点在哪一栏，但仍然可读 */
.dsv-pane[data-focus="0"] .dsv-body{opacity:.62}
.dsv-pane[data-focus="0"] .dsv-paneheader{opacity:1}
.dsv-dot{width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.35;flex:0 0 auto}
/* 标签页状态点：**直接沿用宿主 StateDot 的四态配色**，与侧栏完全同色同义。
   done=已完成(绿) / warning=等待回答(橙) / error=出错(红) / idle=空闲(灰) */
.dsv-dot[data-run="done"]{background-color:#22c55e!important;background-image:none;opacity:1}
.dsv-dot[data-run="warning"]{background-color:#f59e0b!important;background-image:none;opacity:1;animation:dsv-pulse 1.2s ease-in-out infinite}
.dsv-dot[data-run="error"]{background-color:#ef4444!important;background-image:none;opacity:1}
.dsv-dot[data-run="idle"]{background-color:#8b8b90!important;background-image:none;opacity:.85}
/* flex-shrink:1 + min-width：标签多了就一起变窄（文字省略），**不要**让它们溢出被硬裁 ——
   硬裁会把标签右侧圆角和底部蓝条一起切掉，看起来就是「蓝条断了一截」。 */
.dsv-tab{display:flex;align-items:center;gap:3px;flex:0 0 auto;min-width:0;box-sizing:border-box;app-region:no-drag;-webkit-app-region:no-drag;padding:4px 5px 4px 8px;border-radius:6px;font-size:12.5px;line-height:1.4;cursor:pointer;color:inherit;opacity:.62;border:1px solid transparent;white-space:nowrap;overflow:hidden}
.dsv-caret{flex:0 0 auto;width:2px;align-self:stretch;margin:4px 1px;border-radius:1px;background:currentColor;opacity:.45;pointer-events:none}
.dsv-tab:hover{opacity:.9;background:var(--dsh-surface-raised-color,rgba(128,128,128,.1))}
/* 激活标签的底色/描边：每栏自己的"当前标签"都有，但**蓝条只给焦点栏**——
   否则分三栏就有三条蓝条同时亮，分不清哪个是真正的焦点。 */
.dsv-tab[data-active="1"]{opacity:1;background:var(--dsh-surface-raised-color,rgba(128,128,128,.14));border-color:var(--dsh-border-color,rgba(128,128,128,.28))}
/* 非焦点栏的标签压暗：**只压「文字 + 运行圆点」，不压整个标签**。
   opacity 会连带子元素 —— 压整条标签会把 × 按钮一起压暗（0.6 × 0.55 = 0.33），
   按钮看起来像被禁用，这是之前"体验差"的根因。
   现在：文字 0.60 / 0.36，按钮保持自己的 0.55 / 0.60。
   数值来源：Downloads/DSH标签外观数值-可改.xlsx（用户自定）。 */
/* 容器 opacity 归 1：全局 .dsv-tab 有 opacity:.62，若不归零会再乘一次
   （0.62 × 0.36 = 0.22，比目标暗一倍）。 */
.dsv-pane[data-focus="0"] .dsv-tab{opacity:1}
.dsv-pane[data-focus="0"] .dsv-tab > .dsv-tab-label{opacity:.30}
/* 状态圆点（running/unread）**不受非焦点压暗影响** —— 它是跨栏的提醒信号，
   压暗就看不见了（用户实测："未读圆怎么那么暗"）。 */
.dsv-pane[data-focus="0"] .dsv-tab > .dsv-dot[data-run]{opacity:1}
/* 非焦点栏的激活标签也带一条蓝条 —— 让「这一栏有活动标签」一眼可见；
   颜色按文字同样的暗度（60%）绘制，不跟焦点栏抢注意力。
   焦点栏那条是实色（100%），对比依旧清晰。 */
.dsv-pane[data-focus="0"] .dsv-tab[data-active="1"]{background:var(--dsh-surface-raised-color,rgba(128,128,128,.1));border-color:transparent;box-shadow:inset 0 -2px 0 color-mix(in srgb,var(--dsv-tab-accent,#4a8cf7) 40%,transparent)}
.dsv-pane[data-focus="0"] .dsv-tab[data-active="1"] > .dsv-tab-label{opacity:.46}
.dsv-pane[data-focus="0"] .dsv-tab[data-active="1"] > .dsv-dot[data-run]{opacity:1}
/* ── 第三态：焦点所在但未激活（非焦点栏 + 鼠标悬停）───────────────
   与另两态都不同：文字比非焦点亮（.86）、蓝条半亮（72%）、
   再加一圈主色细描边，暗示「点这里焦点就过来」。 */
.dsv-pane[data-focus="0"][data-hovered="1"] .dsv-tab[data-active="1"]{background:color-mix(in srgb,var(--dsv-tab-accent,#4a8cf7) 10%,var(--dsh-surface-raised-color,rgba(128,128,128,.1)));border-color:color-mix(in srgb,var(--dsv-tab-accent,#4a8cf7) 28%,transparent);box-shadow:inset 0 -2px 0 color-mix(in srgb,var(--dsv-tab-accent,#4a8cf7) 58%,transparent)}
.dsv-pane[data-focus="0"][data-hovered="1"] .dsv-tab[data-active="1"] > .dsv-tab-label{opacity:.70}
.dsv-pane[data-focus="0"][data-hovered="1"] .dsv-tab[data-active="1"] > .dsv-dot[data-run]{opacity:1}
.dsv-pane[data-focus="0"][data-hovered="1"] .dsv-body{opacity:.72}
/* ── 侧栏会话行标记 ──────────────────────────────────────────────
   插件接管后宿主不再标记选中行（实测全 aria-selected=false），
   这里用自算的 data-dsv-row 恢复区分：
     focus = 焦点栏当前会话（主色左边条 + 主色淡底 + 文字全亮）
     open  = 其它栏已打开的会话（左侧细线 + 轻微底色 + 文字略淡） */
/* 焦点会话：实心主色左条 3px + 18% 主色底 + 文字加粗全亮 */
[data-row-key^="session:"][data-dsv-row="focus"]{background:color-mix(in srgb,var(--dsv-tab-accent,#4a8cf7) 20%,transparent)!important;box-shadow:inset 3px 0 0 var(--dsv-tab-accent,#4a8cf7)!important;font-weight:600}
[data-row-key^="session:"][data-dsv-row="focus"] *{color:inherit}
/* 已打开但未激活：**用中性灰，不用主色蓝**。
   原先焦点行 20% 蓝、这一档 8% 蓝 —— 同色相靠浓度区分，实测底色对比度只有 1.0x，
   肉眼分不出（用户："跟激活的看不出来什么差别"）。
   改成异色后三档语义一眼分开：焦点=蓝（你在这）/ 已打开=灰（开过）/ 未打开=无色。
   浓度也压到很低：6% 灰底 + 2px 30% 灰左条，不抢注意力。 */
[data-row-key^="session:"][data-dsv-row="open"]{background:color-mix(in srgb,var(--dsv-line,#a7aaaf) 7%,transparent)!important;box-shadow:inset 2px 0 0 color-mix(in srgb,var(--dsv-tab-accent,#4a8cf7) 70%,transparent)!important;font-weight:400}
[data-row-key^="session:"][data-dsv-row="open"] *{opacity:.70}
/* 未打开的会话行：明显更暗更素，让"已打开"一眼跳出来 */
[data-row-key^="session:"]:not([data-dsv-row]) *{opacity:.50}
/* ── 侧栏入口的选中态：跟着「是否在设置页」走 ────────────────────
   宿主的 PanelRow 用 active = activePanelId === id 决定高亮（.panelActive）。
   本插件的 panel id 就是主面板 id，所以只要插件启用、activePanelId 恒等于它，
   侧栏入口就会**一直**是选中态 —— 在工作区里也亮着，看着像"有东西没关"。

   期望行为（用户 2026-11-07 定）：
     · 在设置页  → 选中（你确实点开了这个插件的设置）
     · 在工作区  → 不选中（工作区不是"独立面板"，只是个视图）
   做法：apply 时把 showSettings 同步到 <html data-dsv-settings>，这里只中和 0 分支。
   类名是打包哈希（wtg9ga_*），用 aria 属性选择器更稳。 */
/* 会话状态点：完全交给宿主（._dot_1i3xo_2 + data-state=done/warning/error/idle，
   由 sidebar.session.row.leading 插槽渲染，自带无障碍标签）。
   插件不再自己画侧栏圆点 —— 两套并存会位置打架。 */
/* 呼吸动画：0.9s 一轮（用户要求更快，原 1.6s 太慢） */
@keyframes dsv-pulse{0%,100%{opacity:1}50%{opacity:.4}}
.dsv-pane[data-focus="1"] .dsv-tab[data-active="1"]{box-shadow:inset 0 -2px 0 var(--dsv-tab-accent,#4a8cf7)}
/* 不用 text-overflow:ellipsis —— 省略号本身要占 3 个字符宽，
   在窄标签里宁愿多显示几个真字。直接硬裁（clip）。 */
.dsv-tab-label{min-width:0;overflow:hidden;text-overflow:clip;white-space:nowrap}
.dsv-tab-lock{font-size:9px;line-height:1;opacity:.55;flex:0 0 auto}
.dsv-tab[data-locked="1"]{background:color-mix(in srgb,var(--dsv-line,#a7aaaf) 12%,transparent)}
/* 满栏提示：不可投放的说明标签，不用虚线（虚线表示"能放"） */
.dsv-tab.dsv-limit{pointer-events:none;opacity:.9;border:1px solid color-mix(in srgb,#e0a33e 55%,transparent);background:color-mix(in srgb,#e0a33e 14%,transparent);color:#f0c674;font-size:11.5px}
.dsv-limit-toast{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:8;pointer-events:none;padding:7px 14px;border-radius:8px;font-size:12px;font-weight:600;white-space:nowrap;background:color-mix(in srgb,#e0a33e 18%,var(--dsh-surface-raised-color,rgba(20,20,24,.92)));color:#f0c674;box-shadow:0 2px 10px rgba(0,0,0,.4)}
.dsv-tab-close{display:flex;align-items:center;justify-content:center;flex:0 0 auto;app-region:no-drag;-webkit-app-region:no-drag;width:15px;height:15px;margin-left:auto;border:0;border-radius:4px;background:transparent;color:inherit;font-size:13px;line-height:1;cursor:pointer;opacity:.55;padding:0}
.dsv-tab-close:hover{opacity:1;background:var(--dsh-border-color,rgba(128,128,128,.32))}
.dsv-btn{display:flex;align-items:center;justify-content:center;app-region:no-drag;-webkit-app-region:no-drag;flex:0 0 auto;height:20px;min-width:20px;border:1px solid transparent;border-radius:5px;background:transparent;color:inherit;font-size:14px;line-height:1;cursor:pointer;opacity:.6;padding:0 4px}
.dsv-btn:hover{opacity:1;background:var(--dsh-surface-raised-color,rgba(128,128,128,.12))}
/* 宿主图标 sprite 的尺寸：和官方 Button size="sm" 里的 icon 一致（16×16）。
   symbol 内部 path 自带 stroke/fill=currentColor，所以只设尺寸即可。 */
.dsv-icon{width:16px;height:16px;flex:0 0 auto;display:block;pointer-events:none}
/* 「进入会话」按钮：设置页顶部 / 底部各一个，点它直接回工作区退出设置。
   用宿主自己的表面色变量，深色浅色主题都不违和。 */
/* 「进入会话」主按钮（用户口径 2026-11-08：要大 宽 显眼 居中）。
   刻意用最朴素的属性组合，**不碰 color-mix / box-shadow / flex 居中** ——
   上一版用了那套，实测按钮布局框 620×44 全对，但截图里只有 36% 宽度被
   绘制成蓝底、文字一个像素都没画出来（640 宽条带里白像素 = 0）。
   改成 block + width:100% + line-height 垂直居中 + text-align 水平居中，
   纯色底、无阴影、无渐变，任何 Electron/Chromium 版本都不会翻车。
   ⚠️ flex:0 0 auto 不能删：父级是 flex column，删了之后按钮会被
   flex-shrink 压到 1.33px 高（实测，看起来像「按钮消失了」）。 */
/* 强制独立合成层：对照实验证明同样的盒子放到 body 下（fixed）就完全正常，

   而在设置页容器里只画 38% 宽度、文字不绘制 —— 这是布局正确但合成层"画不全"

   的典型症状，让元素自己成一个层可以绕开。 */

.dsv-enter{display:block;width:100%;flex:0 0 auto;box-sizing:border-box;height:44px;line-height:44px;padding:0;border:0;border-radius:10px;background-color:#4a8cf7;color:#ffffff;font-size:15px;font-weight:600;text-align:center;cursor:pointer}
.dsv-enter:hover{background:#3b7ce6;border-color:#3b7ce6}
.dsv-enter:active{background:#2f6cd0;border-color:#2f6cd0}
/* 文字单独成一个 span：纯文本子节点在部分合成场景下不绘制，包成元素盒后稳定可见。 */
.dsv-enter-label{display:inline-block;pointer-events:none}
.dsv-enter-top{margin:2px 0 6px}
.dsv-enter-bottom{margin:10px 0 6px}

/* min-width 保证「可拖窗口」的像素永远存在：这是该栏空白区唯一的 drag 区域。
   但**最后一栏**不要这个保底 —— 它的 padding-right(145px) 已经是窗口按钮让位区，
   本身就是空白可拖，再占 44px 会把标签挤到只剩 26px。 */
.dsv-spacer{flex:1 1 auto;align-self:stretch;min-width:44px}
.dsv-pane:last-child .dsv-spacer{min-width:0}
/* 标签条空白区：同一块像素「分时复用」，不是二选一。
   闲时整条是系统标题栏带（app-region:drag）→ 拖窗口、双击最大化都归系统；
   只要窗口里有一次拖拽在飞（root 上带 data-drop-armed="1"），整条立刻让给网页（no-drag），
   dragover/drop 才能落到页面 → 标签条可以接投放。
   切换在 dragstart/dragenter 当场发生（下一帧 Chromium 就把新区域推给窗口），
   而指针那时还没走到标签条；松手后两帧复位。拖拽期间没人需要拖窗口，所以对用户无感。 */
.dsv-root[data-drop-armed="1"] .dsv-paneheader{app-region:no-drag;-webkit-app-region:no-drag}
/* 顶部 3px 常驻感应带（y8..11，其上 y0..7 是窗口缩放手柄，系统一律判 HTTOP）：跨应用（资源管理器）拖文件进来时，指针第一次进入窗口就可能落在标题栏带上，
   那一次 dragenter 会被系统吞掉、永远等不到 arm。留一条极窄的网页区域接住这第一次 dragenter。 */
.acoR2W_session[hidden]{display:contents !important}
/* ⚠️ 这条带必须放在标题栏**下方**（top:44 = 标签条高度），不能放在标题栏里面。
   -webkit-app-region 是「绘制区域」属性：即使 pointer-events:none，Chromium 也会把这块像素
   从窗口可拖动区里扣掉 → 双击正好落在那 3px 上时系统不认成标题栏双击，最大化时灵时不灵
   （2026-11-09 实测：y8..11 被抠掉，占标题栏高度 44px 的 7%，与用户「很少情况下」吻合）。
   放 y44 起：那里本来就不是拖动区，不损失任何像素；pointer-events:none 说明它也从没接过事件，
   所以只是把「扣掉拖动区」这个副作用移出标题栏。 */
.dsv-dropband{position:fixed;top:44px;left:0;right:0;height:3px;z-index:61;background:transparent;pointer-events:none;app-region:no-drag;-webkit-app-region:no-drag}
.dsv-body{flex:1 1 auto;min-height:0;min-width:0;display:flex;flex-direction:column;overflow:hidden;position:relative}
.dsv-body>*{flex:1 1 auto;min-height:0;min-width:0;height:100%}
/* The host's content factory has an embedded variant: passing variant "embedded"
   gives the body the embeddedBody class plus data-content-phase, which is what
   makes the host's own rules apply (sticky composer seat in the active phase,
   centred hero in the hero phase). No overrides are needed — this rule only
   guards the case where a future host drops that variant. */
.dsv-body [data-conversation-content]:not([data-content-phase]) [data-composer-seat]{position:sticky;bottom:0;z-index:7}
.dsv-divider{flex:0 0 7px;position:relative;cursor:col-resize;touch-action:none;background:transparent;app-region:no-drag;-webkit-app-region:no-drag}
.dsv-divider::after{content:"";position:absolute;top:0;bottom:0;left:2px;width:var(--dsv-line-w,2px);border-radius:calc(var(--dsv-line-w,2px) / 2);background:var(--dsv-line-soft,var(--dsv-line,#a7aaaf));transition:background .12s,width .12s}
.dsv-divider:hover::after,.dsv-divider[data-dragging="1"]::after{background:var(--dsv-line,#a7aaaf);width:var(--dsv-line-w,2px)}
.dsv-divider[data-drop="1"]::after{background:var(--dsv-line,#a7aaaf);width:calc(var(--dsv-line-w,2px) + 1px);left:2px}
.dsv-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;height:100%;font-size:13px;opacity:.55;padding:20px;text-align:center;line-height:1.6}
.dsv-empty kbd{font-family:inherit;border:1px solid var(--dsh-border-color,rgba(128,128,128,.35));border-radius:4px;padding:0 4px}
.dsv-panes[data-narrow="1"]{flex-direction:column}
/* 竖排（窗口很窄时）：标签条必须回到文档流，否则每个栏的 fixed header 都叠在 y=0 */
.dsv-panes[data-narrow="1"] .dsv-paneheader{position:static;width:100%!important;left:auto!important}
.dsv-panes[data-narrow="1"] .dsv-pane{padding-top:0}
.dsv-panes[data-narrow="1"] .dsv-pane{width:100%!important;flex:1 1 0!important;min-height:0}
.dsv-panes[data-narrow="1"] .dsv-divider{flex:0 0 1px;cursor:row-resize}
.dsv-panes[data-narrow="1"] .dsv-divider::after{top:0;bottom:auto;left:0;right:0;width:auto;height:1px;border-radius:0}
/* Desktop shell: keep the last strip clear of the window buttons painted by the
   title-bar overlay (they are not part of the page, so they win every click). */
.dsv-root[data-shell="desktop"] .dsv-pane:last-child .dsv-paneheader{padding-right:calc(8px + var(--dsv-caption-inset,0px))}
/* Plugin settings page (also shown when the workspace is switched off). */
/* ⚠️ 不要用 display:flex + justify-content:center 来居中内容。

   实测（2026-11-08，有对照实验）：这种组合下里面的按钮布局框是 620×44 全对，

   但**只绘制了左边 235px 宽、文字一个像素都没画**；同样的样式用 position:fixed

   放到 body 下就完全正常（98.3% 蓝底 + 1811 个白像素）。

   改成 block + 子元素 margin:0 auto 居中，行为就正常了。 */

.dsv-settings{flex:1 1 auto;min-height:0;overflow:auto;display:block;padding:36px 24px}
.dsv-settings-inner{width:100%;max-width:620px;margin:0 auto;display:flex;flex-direction:column;gap:18px}
/* 设置页分组小标题：把十几张卡分成「开关 / 视图条 / 分隔线外观」几组，
   否则平铺下来分不清哪几张是一组。纯排版，不带任何交互。 */
.dsv-group-title{font-size:11.5px;font-weight:600;letter-spacing:.02em;opacity:.55;margin:6px 0 -8px}
.dsv-settings h2{margin:0;font-size:17px;font-weight:600}
.dsv-settings p{margin:0;font-size:13px;line-height:1.65;opacity:.72}
.dsv-card{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 16px;border:1px solid var(--dsh-border-color,rgba(128,128,128,.26));border-radius:10px}
.dsv-card-text{display:flex;flex-direction:column;gap:4px;min-width:0}
.dsv-card-title{font-size:13px;font-weight:600}
.dsv-card-desc{font-size:12px;line-height:1.55;opacity:.62}
.dsv-card-col{flex-direction:column;align-items:stretch;gap:10px}
.dsv-swatches{display:flex;flex-wrap:wrap;gap:8px}
.dsv-swatch{display:flex;align-items:center;gap:6px;padding:5px 9px 5px 6px;border-radius:8px;border:1px solid var(--dsh-border-color,rgba(128,128,128,.26));background:transparent;color:inherit;font-size:12px;font-family:inherit;cursor:pointer;opacity:.7;transition:opacity .12s,border-color .12s}
.dsv-swatch:hover{opacity:1}
.dsv-swatch[data-on="1"]{opacity:1;border-color:var(--swatch);box-shadow:0 0 0 1px var(--swatch) inset}
.dsv-swatch-dot{width:14px;height:14px;border-radius:50%;background:var(--swatch);flex:0 0 auto}
.dsv-swatch-name{white-space:nowrap}
.dsv-width{padding-left:9px}
.dsv-width-bar{width:22px;border-radius:2px;background:var(--dsv-line,#a7aaaf);flex:0 0 auto}
/* 不透明度档位：用不同浓度的色条直观展示"这个档位有多浓" */
.dsv-opacity-bar{width:22px;height:3px;border-radius:1.5px;flex:0 0 auto}
.dsv-switch{position:relative;flex:0 0 auto;width:40px;height:22px;border-radius:11px;border:1px solid var(--dsh-border-color,rgba(128,128,128,.4));background:transparent;cursor:pointer;padding:0;transition:background .14s,border-color .14s}
.dsv-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:currentColor;opacity:.55;transition:transform .14s,opacity .14s}
.dsv-switch[data-on="1"]{background:var(--dsh-accent-color,#4a8cf7);border-color:var(--dsh-accent-color,#4a8cf7)}
.dsv-switch[data-on="1"]::after{transform:translateX(18px);background:#fff;opacity:1}
.dsv-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsv-primary{height:28px;padding:0 12px;border-radius:7px;border:1px solid var(--dsh-accent-color,#4a8cf7);background:var(--dsh-accent-color,#4a8cf7);color:#fff;font-size:12px;font-family:inherit;cursor:pointer}
.dsv-ghost{height:28px;padding:0 12px;border-radius:7px;border:1px solid var(--dsh-border-color,rgba(128,128,128,.35));background:transparent;color:inherit;font-size:12px;font-family:inherit;cursor:pointer}
.dsv-ghost:hover{background:var(--dsh-surface-raised-color,rgba(128,128,128,.12))}
.dsv-hint{font-size:11px;line-height:1.6;opacity:.5}
`;

		/**
		 * Install the stylesheet once per document.
		 */
		function installStyles() {
			try {
				if (document.getElementById(STYLE_ID) !== null) return;
				const style = document.createElement("style");
				style.id = STYLE_ID;
				style.textContent = CSS;
				document.head.appendChild(style);
			} catch (error) {
				console.warn("[split-view] styles unavailable:", error);
			}
		}
		//#endregion

		//#region state model
		let idCounter = 0;
		function newId(prefix) {
			idCounter += 1;
			return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}`;
		}

		function makeTab(sessionId, locked) {
			return { id: newId("t"), sessionId: typeof sessionId === "string" ? sessionId : null };
		}

		function makePane(sessionId) {
			const tab = makeTab(sessionId);
			return { id: newId("p"), tabs: [tab], activeTabId: tab.id, weight: 1 };
		}

		function defaultState() {
			const pane = makePane(null);
			return { panes: [pane], focusPaneId: pane.id };
		}

		/**
		 * Normalise whatever came out of localStorage into a usable workspace.
		 *
		 * @param raw - parsed JSON, possibly garbage.
		 * @returns a workspace state that always has at least one pane.
		 */
		function sanitize(raw) {
			if (raw === null || typeof raw !== "object" || !Array.isArray(raw.panes)) return defaultState();
			const panes = [];
			for (const candidate of raw.panes.slice(0, MAX_PANES)) {
				if (candidate === null || typeof candidate !== "object" || !Array.isArray(candidate.tabs)) continue;
				const tabs = [];
				for (const tabCandidate of candidate.tabs) {
					if (tabCandidate === null || typeof tabCandidate !== "object") continue;
					tabs.push({
						id: typeof tabCandidate.id === "string" ? tabCandidate.id : newId("t"),
						sessionId: typeof tabCandidate.sessionId === "string" ? tabCandidate.sessionId : null,
						locked: tabCandidate.locked === true
					});
				}
				if (tabs.length === 0) tabs.push(makeTab(null));
				const activeTabId = tabs.some((tab) => tab.id === candidate.activeTabId) ? candidate.activeTabId : tabs[0].id;
				const weight = typeof candidate.weight === "number" && Number.isFinite(candidate.weight) && candidate.weight > 0 ? candidate.weight : 1;
				panes.push({ id: typeof candidate.id === "string" ? candidate.id : newId("p"), tabs, activeTabId, weight });
			}
			if (panes.length === 0) return defaultState();
			const focusPaneId = panes.some((pane) => pane.id === raw.focusPaneId) ? raw.focusPaneId : panes[0].id;
			return { panes, focusPaneId };
		}

		function readState() {
			try {
				const raw = window.localStorage.getItem(STORAGE_KEY);
				if (raw === null) return defaultState();
				return sanitize(JSON.parse(raw));
			} catch {
				return defaultState();
			}
		}

		function writeState(state) {
			try {
				window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
			} catch {
				/* storage unavailable — the workspace still works for this session */
			}
		}

		/** 切换某个标签的锁定状态。锁定后 closeTab 会直接拒绝。 */
		function toggleLockTab(state, paneId, tabId) {
			return {
				...state,
				panes: state.panes.map((pane) =>
					pane.id === paneId
						? { ...pane, tabs: pane.tabs.map((tab) => (tab.id === tabId ? { ...tab, locked: tab.locked !== true } : tab)) }
						: pane
				)
			};
		}

		/**
		 * Re-normalise weights so they sum to one, keeping relative sizes.
		 *
		 * @param panes - panes carrying raw weights.
		 * @returns panes with weights summing to one.
		 */
		function normaliseWeights(panes) {
			const total = panes.reduce((sum, pane) => sum + (pane.weight > 0 ? pane.weight : 1), 0);
			return panes.map((pane) => ({ ...pane, weight: (pane.weight > 0 ? pane.weight : 1) / total }));
		}

		/**
		 * 删掉一栏时，把它占的宽度**交给相邻那一栏**（左邻居优先）。
		 *
		 * 不能直接 filter 掉再 normaliseWeights——那会把剩下的栏按比例放大：
		 * 三栏 0.5/0.25/0.25 去掉最右，直接归一化变成 0.667/0.333，左栏莫名其妙变宽。
		 * 正确结果是 0.5/0.5。
		 */
		function removePaneGivingWeight(panes, removeId) {
			const index = panes.findIndex((pane) => pane.id === removeId);
			if (index < 0) return panes;
			const gone = panes[index];
			const rest = panes.filter((pane) => pane.id !== removeId);
			if (rest.length === 0) return panes;
			const goneWeight = gone.weight > 0 ? gone.weight : 1;
			const heir = index > 0 ? rest[index - 1] : rest[0];
			const withHeir = rest.map((pane) =>
				pane.id === heir.id ? { ...pane, weight: (pane.weight > 0 ? pane.weight : 1) + goneWeight } : pane
			);
			return normaliseWeights(withHeir);
		}

		/**
		 * 在 `at` 位置插入一个只放 `tab` 的新栏，宽度从相邻那栏分一半过来。
		 * 分栏与「拖到分隔条」共用同一条算宽度规则。
		 */
		function insertPaneWithTab(panes, at, tab, splitPaneId) {
			const index = Math.max(0, Math.min(at, panes.length));
			const neighbour = splitTargetOf(panes, index, splitPaneId);
			const neighbourWeight = neighbour !== void 0 && neighbour.weight > 0 ? neighbour.weight : 1;
			const half = neighbourWeight / 2;
			const pane = { id: newId("p"), tabs: [tab], activeTabId: tab.id, weight: half };
			const adjusted = panes.map((item) =>
				neighbour !== void 0 && item.id === neighbour.id ? { ...item, weight: half } : item
			);
			return {
				panes: normaliseWeights([...adjusted.slice(0, index), pane, ...adjusted.slice(index)]).slice(0, MAX_PANES),
				pane
			};
		}

		/**
		 * Which pane currently holds the session, if any.
		 *
		 * @param state - workspace state.
		 * @param sessionId - session to look for.
		 * @returns `{ pane, tab }` when already displayed.
		 */
		function findSession(state, sessionId) {
			for (const pane of state.panes) {
				const tab = pane.tabs.find((candidate) => candidate.sessionId === sessionId);
				if (tab !== void 0) return { pane, tab };
			}
			return void 0;
		}

		/**
		 * The rule the workspace follows when a session is opened:
		 * already displayed → focus it, never duplicate; otherwise write it into
		 * the target pane (replace the active tab, or append a new one).
		 *
		 * @param state - workspace state.
		 * @param sessionId - session to open.
		 * @param mode - "replace" (click) or "tab" (drop).
		 * @param paneId - target pane; defaults to the focused one.
		 * @returns next state.
		 */
		function openSession(state, sessionId, mode, paneId) {
			if (typeof sessionId !== "string" || sessionId === "") return state;
			const existing = findSession(state, sessionId);
			if (existing !== void 0) {
				return {
					...state,
					focusPaneId: existing.pane.id,
					panes: state.panes.map((pane) =>
						pane.id === existing.pane.id ? { ...pane, activeTabId: existing.tab.id } : pane
					)
				};
			}
			const targetId = paneId ?? state.focusPaneId;
			const target = state.panes.find((pane) => pane.id === targetId) ?? state.panes[0];
			if (target === void 0) {
				const pane = makePane(sessionId);
				return { panes: [pane], focusPaneId: pane.id };
			}
			const active = target.tabs.find((tab) => tab.id === target.activeTabId) ?? target.tabs[0];
			const panes = state.panes.map((pane) => {
				if (pane.id !== target.id) return pane;
				if (mode === "tab" || active === void 0) {
					const tab = makeTab(sessionId);
					return { ...pane, tabs: [...pane.tabs, tab], activeTabId: tab.id };
				}
				const tabs = pane.tabs.map((tab) => (tab.id === active.id ? { ...tab, sessionId } : tab));
				return { ...pane, tabs, activeTabId: active.id };
			});
			return { ...state, focusPaneId: target.id, panes };
		}

		/**
		 * Close one tab, moving focus to its neighbour.
		 *
		 * @param state - workspace state.
		 * @param paneId - owning pane.
		 * @param tabId - tab to close.
		 * @returns next state.
		 */
		function closeTab(state, paneId, tabId) {
			const owner = state.panes.find((pane) => pane.id === paneId);
			if (owner === void 0) return state;
			const index = owner.tabs.findIndex((tab) => tab.id === tabId);
			if (index < 0) return state;
			/* 锁定的标签不可关闭 —— 双击、中键、× 三条路最后都走这里，所以只需拦一处。 */
			if (owner.tabs[index].locked === true) return state;
			const tabs = owner.tabs.filter((tab) => tab.id !== tabId);
			if (tabs.length === 0) {
				/* The pane's last tab closed = that pane goes away (there is no ⊟ button
				   any more); the workspace always keeps at least one pane. */
				if (state.panes.length > 1) return closePane(state, paneId);
				return {
					...state,
					panes: state.panes.map((pane) =>
						pane.id === paneId ? { ...pane, tabs: [makeTab(null)], activeTabId: null } : pane
					)
				};
			}
			const nextActive = owner.activeTabId === tabId ? tabs[Math.min(index, tabs.length - 1)].id : owner.activeTabId;
			return {
				...state,
				panes: state.panes.map((pane) => (pane.id === paneId ? { ...pane, tabs, activeTabId: nextActive } : pane))
			};
		}

		/**
		 * Add an empty tab to a pane and focus it.
		 */
		function addBlankTab(state, paneId) {
			const panes = state.panes.map((pane) => {
				if (pane.id !== paneId) return pane;
				const tab = makeTab(null);
				return { ...pane, tabs: [...pane.tabs, tab], activeTabId: tab.id };
			});
			return { ...state, panes, focusPaneId: paneId };
		}

		/**
		 * Close a whole pane. The workspace always keeps at least one pane.
		 */
		function closePane(state, paneId) {
			if (state.panes.length <= 1) return state;
			/* 关掉一栏时把它的宽度交给邻居；直接 filter + 归一化会让剩下的栏一起变宽。 */
			const panes = removePaneGivingWeight(state.panes, paneId);
			const focusPaneId = panes.some((pane) => pane.id === state.focusPaneId) ? state.focusPaneId : panes[0].id;
			return { panes, focusPaneId };
		}

		/**
		 * 挑出「这次分栏要拆哪一栏」——也就是权重从谁身上劈一半。
		 *
		 * ⚠️ 不能简单用 `panes[at - 1]`：那个是**插入位的左邻居**，
		 * 只在「插到目标栏右侧」时恰好等于目标栏。
		 * 在目标栏**左侧**分栏时（at = 目标栏下标），`at - 1` 是目标栏的
		 * **左邻居**，会把左边那一栏拆开 —— 2026-11-07 用户实测：
		 * 两栏各 50%，拖到右栏左半边松手得到 25/25/50（左栏被拆了），
		 * 正确应是 50/25/25。
		 *
		 * @param panes - 分栏前的栏数组。
		 * @param at - 新栏的插入下标。
		 * @param splitPaneId - 要拆的那一栏的 id（分栏场景必传；重建/兜底场景可省略）。
		 * @returns 被拆的栏，或 undefined。
		 */
		function splitTargetOf(panes, at, splitPaneId) {
			if (typeof splitPaneId === "string" && splitPaneId !== "") {
				const explicit = panes.find((pane) => pane.id === splitPaneId);
				if (explicit !== void 0) return explicit;
			}
			return panes[at - 1] ?? panes[at] ?? void 0;
		}

		/**
		 * Insert a pane at `index` that shows `sessionId`.
		 */
		function insertPane(state, index, sessionId, splitPaneId) {
			if (state.panes.length >= MAX_PANES) return state;
			const pane = makePane(sessionId);
			/* 新栏从**相邻那一栏**手里分一半过来（不是取全局平均值）：
			   否则单栏分成两栏时会变成 0.667 / 0.333，左右宽度明显不一样。 */
			const neighbour = splitTargetOf(state.panes, index, splitPaneId);
			const neighbourWeight = neighbour !== void 0 && neighbour.weight > 0 ? neighbour.weight : 1;
			const half = neighbourWeight / 2;
			pane.weight = half;
			const adjusted = state.panes.map((item) => (neighbour !== void 0 && item.id === neighbour.id ? { ...item, weight: half } : item));
			const panes = normaliseWeights([...adjusted.slice(0, index), pane, ...adjusted.slice(index)]);
			return { panes, focusPaneId: pane.id };
		}

		/**
		 * Move a tab between panes (or into a brand new one).
		 */
		function moveTab(state, fromPaneId, tabId, toPaneId) {
			if (fromPaneId === toPaneId) return state;
			const from = state.panes.find((pane) => pane.id === fromPaneId);
			const tab = from?.tabs.find((candidate) => candidate.id === tabId);
			if (tab === void 0) return state;
			const panes = state.panes.map((pane) => {
				if (pane.id === fromPaneId) {
					const tabs = pane.tabs.filter((candidate) => candidate.id !== tabId);
					if (tabs.length === 0) return { ...pane, tabs: [makeTab(null)], activeTabId: null };
					const activeTabId = pane.activeTabId === tabId ? tabs[0].id : pane.activeTabId;
					return { ...pane, tabs, activeTabId };
				}
				if (pane.id === toPaneId) return { ...pane, tabs: [...pane.tabs, tab], activeTabId: tab.id };
				return pane;
			});
			return { ...state, panes, focusPaneId: toPaneId };
		}

		/**
		 * Take a tab out of its pane. Unlike closeTab/moveTab the emptied pane is
		 * dropped instead of being left behind with a blank tab — that is what makes
		 * "drag the last tab out of a pane" behave like Hermes: the pane goes away.
		 * The one exception is the last remaining pane, which always survives.
		 */
		function detachTab(state, paneId, tabId) {
			const source = state.panes.find((pane) => pane.id === paneId);
			const moved = source?.tabs.find((candidate) => candidate.id === tabId);
			if (moved === void 0) return null;
			const rest = source.tabs.filter((candidate) => candidate.id !== tabId);
			const without = state.panes
				.map((pane) => {
					if (pane.id !== paneId) return pane;
					if (rest.length === 0) return null;
					return {
						...pane,
						tabs: rest,
						activeTabId: pane.activeTabId === tabId ? rest[0].id : pane.activeTabId
					};
				})
				.filter((pane) => pane !== null);
			if (without.length === 0) {
				return { moved, panes: [{ ...source, tabs: [makeTab(null)], activeTabId: null }] };
			}
			/* 源栏被拖空了 → 它的宽度交给邻居，而不是让剩下的栏按比例放大。 */
			if (rest.length === 0) return { moved, panes: removePaneGivingWeight(state.panes, paneId), removed: true };
			return { moved, panes: normaliseWeights(without), removed: false };
		}

		/**
		 * Drop a tab somewhere. `side` "left"/"right" means the pointer was on an
		 * outer quarter, so the tab gets its own pane on that side. Without a side
		 * the tab simply joins the pane it was dropped on.
		 */
		function dropTab(state, fromPaneId, tabId, toPaneId, side) {
			const edge = side === "left" || side === "right";
			// Dragging the only tab of the only pane to its own edge is a no-op.
			if (edge && state.panes.length === 1 && state.panes[0].id === fromPaneId && state.panes[0].tabs.length === 1) return state;
			/* 拖到自己栏、又不是放到边缘 = 什么都不用做。
			   少了这句会先把标签 detach 掉、再把空栏回收，看起来像“凭空多了一栏”。 */
			if (!edge && fromPaneId === toPaneId) return state;
			const detached = detachTab(state, fromPaneId, tabId);
			if (detached === null) return state;
			if (edge && detached.panes.length < MAX_PANES) {
				const index = detached.panes.findIndex((pane) => pane.id === toPaneId);
				if (index >= 0) {
					/* 分栏 = 把**被拖到的那一栏**一分为二，两半等宽。
					   旧实现给新栏 weight=总权重/(n+1)、原栏保持原权重，归一化后变成
					   0.667/0.333 —— 左边明显比右边宽。 */
					const at = side === "left" ? index : index + 1;
					/* 拆**目标栏自己**（toPaneId）：左侧分栏时 at=index，
					   若按 at-1 取邻居会拆到左邻居身上。 */
					const split = insertPaneWithTab(detached.panes, at, detached.moved, toPaneId);
					return { panes: split.panes, focusPaneId: split.pane.id };
				}
			}
			// Plain move, or no room for another pane: join the target as a tab.
			const joined = detached.panes.map((pane) =>
				pane.id === toPaneId ? { ...pane, tabs: [...pane.tabs, detached.moved], activeTabId: detached.moved.id } : pane
			);
			if (joined.some((pane) => pane.id === toPaneId)) return { ...state, panes: joined, focusPaneId: toPaneId };
			/* 目标栏已经被 detach 掉了（拖自己栏唯一的标签到自己的边缘就是这种）：
			   必须在原位置给它重建一栏，**不能**像旧代码那样直接返回——那会把标签丢掉。 */
			const fromIndex = state.panes.findIndex((pane) => pane.id === fromPaneId);
			const fallbackAt = fromIndex < 0 ? detached.panes.length : Math.min(fromIndex, detached.panes.length);
			const rebuilt = insertPaneWithTab(detached.panes, fallbackAt, detached.moved);
			return { panes: rebuilt.panes, focusPaneId: rebuilt.pane.id };
		}

		/**
		 * 同一栏内把标签从 fromIndex 挪到 toIndex（toIndex 是插入位，按**移动前**的
		 * 顺序算，即 0..tabs.length）。移除自身后下标要减 1，否则往后拖会差一格。
		 */
		function reorderTab(state, paneId, tabId, toIndex) {
			return {
				...state,
				panes: state.panes.map((pane) => {
					if (pane.id !== paneId) return pane;
					const from = pane.tabs.findIndex((candidate) => candidate.id === tabId);
					if (from < 0) return pane;
					const tabs = pane.tabs.slice();
					const [moved] = tabs.splice(from, 1);
					const at = Math.max(0, Math.min(tabs.length, toIndex > from ? toIndex - 1 : toIndex));
					tabs.splice(at, 0, moved);
					return { ...pane, tabs };
				})
			};
		}
		//#endregion

		//#region services / hooks
		function rowLabel(row) {
			const candidate = row.displayTitle ?? row.title ?? row.name ?? row.cwd ?? row.id;
			const text = typeof candidate === "string" && candidate.trim() !== "" ? candidate.trim() : row.id;
			return typeof text === "string" ? text : "";
		}

		function sessionRows(snapshot) {
			const ids = Array.isArray(snapshot?.ids) ? snapshot.ids : [];
			const byId = snapshot?.byId ?? {};
			const rows = [];
			for (const id of ids) {
				const row = byId[id];
				if (row !== void 0 && row !== null) rows.push(row);
			}
			return rows;
		}

		function useSessionList(sessions) {
			const subscribe = react.useCallback(
				(listener) => {
					if (sessions === void 0) return () => {};
					try {
						return sessions.list.subscribe(listener);
					} catch {
						return () => {};
					}
				},
				[sessions]
			);
			const getSnapshot = react.useCallback(() => {
				if (sessions === void 0) return EMPTY_LIST;
				try {
					return sessions.list.getSnapshot() ?? EMPTY_LIST;
				} catch {
					return EMPTY_LIST;
				}
			}, [sessions]);
			return react.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
		}

		/**
		 * The workspace only needs a handful of fields per row: title, running flag
		 * and blank flag. Subscribing to the raw list would re-render every pane on
		 * every streamed token (the host rewrites projections constantly), which is
		 * what made the UI feel frozen while a session was running. This keeps the
		 * rows in a ref and only re-renders when the derived signature changes.
		 *
		 * @param sessions - the sessions service, possibly undefined.
		 * @returns a Map from session id to row.
		 */
		function useRowMap(sessions) {
			const [, force] = react.useReducer((n) => n + 1, 0);
			const mapRef = react.useRef(new Map());
			const signatureRef = react.useRef("");

			react.useEffect(() => {
				if (sessions === void 0) return;
				let list;
				try {
					list = sessions.list;
				} catch {
					return;
				}
				if (list === void 0) return;
				const read = () => {
					let snapshot;
					try {
						snapshot = list.getSnapshot();
					} catch {
						return;
					}
					const map = new Map();
					let signature = "";
					for (const row of sessionRows(snapshot)) {
						map.set(row.id, row);
						signature += `${row.id}|${rowLabel(row)}|${row.running === true ? 1 : 0}|${row.blank === true ? 1 : 0};`;
					}
					mapRef.current = map;
					if (signature !== signatureRef.current) {
						signatureRef.current = signature;
						force();
					}
				};
				read();
				let unsubscribe = () => {};
				try {
					unsubscribe = list.subscribe(read);
				} catch {
					/* a list without subscribe still renders once */
				}
				return () => {
					try {
						unsubscribe();
					} catch {
						/* ignore */
					}
				};
			}, [sessions]);

			return mapRef.current;
		}


		function makeReference(sessions, sessionId) {
			if (typeof sessionId !== "string" || sessionId === "") return void 0;
			let binding;
			try {
				binding = typeof sessions.binding === "function" ? sessions.binding(sessionId) : void 0;
			} catch {
				binding = void 0;
			}
			if (binding === void 0) return void 0;
			return { sessionId, binding };
		}

		/**
		 * Retain a session so the controller materialises a scope (and therefore a
		 * binding token). The reference is re-derived on every render from the live
		 * controller, so a dropped or re-materialised scope can never leave a stale
		 * owner token behind (which would throw inside the scope provider).
		 *
		 * Moving a tab between panes unmounts the old subtree before the new one
		 * mounts, so releasing straight to zero makes the host drop the binding and
		 * the incoming composer reports `conversation.input … resolved no binding`.
		 * A short grace window (and a refcount) keeps the binding alive across the
		 * gesture.
		 */
		const RELEASE_GRACE_MS = 500;
		const retainGuard = new Map();

		/* 引用计数的 key 带上 source：同一个会话可能同时被
		   "splitView"（普通标签）和 "mainView"（焦点栏激活标签）各保留一次，
		   两者必须各自独立计数、独立释放，否则释放其中一个会连带另一个。 */
		function retainKey(sessionId, source) {
			return `${source}::${sessionId}`;
		}

		function retainSession(sessions, sessionId, source) {
			const src = typeof source === "string" && source !== "" ? source : RETAIN_SOURCE;
			const key = retainKey(sessionId, src);
			let entry = retainGuard.get(key);
			if (entry === void 0) {
				entry = { count: 0, timer: null, handle: null, sessionId, source: src };
				retainGuard.set(key, entry);
			}
			if (entry.timer !== null) {
				clearTimeout(entry.timer);
				entry.timer = null;
			}
			entry.count += 1;
			if (entry.handle === null) {
				try {
					entry.handle = sessions.retain(sessionId, { source: src });
				} catch (error) {
					entry.count -= 1;
					if (entry.count <= 0) retainGuard.delete(key);
					throw error;
				}
			}
		}

		function releaseSession(sessionId, source) {
			const src = typeof source === "string" && source !== "" ? source : RETAIN_SOURCE;
			const key = retainKey(sessionId, src);
			const entry = retainGuard.get(key);
			if (entry === void 0) return;
			entry.count -= 1;
			if (entry.count > 0) return;
			if (entry.timer !== null) clearTimeout(entry.timer);
			entry.timer = setTimeout(() => {
				const current = retainGuard.get(key);
				if (current === void 0 || current.count > 0) return;
				retainGuard.delete(key);
				try {
					current.handle?.release?.();
				} catch {
					/* already released */
				}
			}, RELEASE_GRACE_MS);
		}

		function useSessionReference(sessions, sessionId) {
			const [, bump] = react.useReducer((n) => n + 1, 0);

			react.useEffect(() => {
				if (sessions === void 0 || typeof sessionId !== "string" || sessionId === "") return;
				let held = false;
				let unsubscribe;
				let disposed = false;
				let attempts = 0;
				let timer = null;

				// Right after a reload the controller may not know the session yet, so a
				// single attempt would leave the tab permanently empty. Retry briefly.
				const acquire = () => {
					if (disposed) return;
					try {
						retainSession(sessions, sessionId);
						held = true;
					} catch (error) {
						attempts += 1;
						if (attempts > 40) {
							console.warn("[split-view] retain failed:", error);
							return;
						}
						timer = setTimeout(acquire, 250);
						return;
					}
					try {
						unsubscribe = sessions.retainInfo(sessionId).subscribe(() => bump());
					} catch {
						unsubscribe = void 0;
					}
					bump();
				};

				acquire();

				return () => {
					disposed = true;
					if (timer !== null) clearTimeout(timer);
					if (typeof unsubscribe === "function") {
						try {
							unsubscribe();
						} catch {
							/* already gone */
						}
					}
					if (held) releaseSession(sessionId);
				};
			}, [sessions, sessionId]);

			const reference = makeReference(sessions, sessionId);
			return { reference, status: reference === void 0 ? "pending" : "ready" };
		}
		//#endregion

		//#region components
		/**
		 * Keeps one pane's failure inside that pane instead of blanking the shell.
		 */
		class PaneBoundary extends react.Component {
			constructor(props) {
				super(props);
				this.state = { error: null };
			}
			static getDerivedStateFromError(error) {
				return { error };
			}
			componentDidCatch(error) {
				try {
					console.warn("[split-view] pane crashed:", error);
				} catch {
					/* ignore */
				}
			}
			render() {
				if (this.state.error !== null) {
					const message = this.state.error?.message ?? String(this.state.error);
					return h("div", { className: "dsv-empty" }, `该标签页渲染失败：${message}`);
				}
				return this.props.children;
			}
		}

		/**
		 * Last-resort guard around the whole workspace: if it cannot render at all,
		 * hand the main view back to the host's own conversation panel so the user is
		 * never left staring at an empty screen.
		 */
		class WorkspaceBoundary extends react.Component {
			constructor(props) {
				super(props);
				this.state = { error: null };
			}
			static getDerivedStateFromError(error) {
				return { error };
			}
			componentDidCatch(error) {
				try {
					console.warn("[split-view] workspace crashed:", error);
				} catch {
					/* ignore */
				}
			}
			render() {
				if (this.state.error === null) return this.props.children;
				const message = this.state.error?.message ?? String(this.state.error);
				return h(
					"div",
					{ className: "dsv-empty" },
					h("div", null, `多栏视图渲染失败：${message}`),
					h(
						"button",
						{
							type: "button",
							className: "dsv-btn",
							style: { marginTop: "10px", padding: "4px 10px", border: "1px solid currentColor", borderRadius: "6px" },
							onClick: () => {
								try {
									service("layout")?.selectPanel?.(NATIVE_PANEL);
								} catch {
									/* nothing else to try */
								}
							}
						},
						"回到单栏视图"
					)
				);
			}
		}

		/**
		 * The conversation body of one tab: the host's own content factory, bound to
		 * the tab's session through the scope provider.
		 */
		function TabContent(props) {
			const { sessionId, hero, sessions, renderFactorySlot, SessionProvider, renderSlot, viewBarOn } = props;
			const { reference, status } = useSessionReference(sessions, sessionId);
			const phase = hero ? "hero" : "active";
			/* The host's own conversation panel is a slot entry in `main.conversation`
			   (client-ui-conversation). That entry is what declares `conversation.header`
			   — i.e. the title, the 标准模式/费用明细/子智能体 chips and the
			   对话/轨迹/上下文/编队 strip — and it receives the same prop bag this entry
			   gets. Rendering it per pane gives a COMPLETE session (header + body +
			   composer) in every pane, which is what the split view is supposed to be,
			   instead of the bare content factory that silently dropped the header.
			   The lookup must stay ABOVE every early return: a hook after a conditional
			   return changes the hook count and React throws #310. */
			const hostPanel = react.useMemo(() => {
				try {
					const slots = service("slots");
					const list = slots?.entriesOfSlot?.("main.conversation") ?? [];
					for (const entry of list) {
						if (typeof entry?.component === "function") return entry.component;
					}
				} catch (error) {
					if (typeof window !== "undefined") {
						window.__dsvHeadDebug = window.__dsvHeadDebug ?? [];
						window.__dsvHeadDebug.push({ panel: String(error?.message ?? error) });
					}
				}
				return null;
			}, []);

			/* The `conversation` panel entry in `main` is just
			   `({ renderSlot }) => renderSlot("main.conversation", {})`. That entry OWNS
			   the `main.conversation` child slot, so calling it from inside our own
			   SessionProvider lets the host do its normal session-scope prop injection:
			   we do not have to forge useSession/useProjection any more. */
			const hostConversation = react.useMemo(() => {
				try {
					const slots = service("slots");
					for (const entry of slots?.entriesOfSlot?.("main") ?? []) {
						const key = entry?.options?.key ?? entry?.key;
						if (key === "conversation" && typeof entry?.component === "function") return entry.component;
					}
				} catch {}
				return null;
			}, []);

			if (typeof renderFactorySlot !== "function") return h("div", { className: "dsv-empty" }, "宿主未提供 conversation.content 工厂");

			// A blank tab is the host's own "new session" page: the content factory
			// rendered with no session in scope, which is exactly what the native
			// panel shows before the first message.
			if (sessionId === null) {
				return h(
					PaneBoundary,
					null,
					renderFactorySlot(CONTENT_FACTORY, { variant: "embedded", phase: "hero", hero: true })
				);
			}
			if (sessions === void 0) return h("div", { className: "dsv-empty" }, "sessions 服务不可用");
			if (reference === void 0) {
				return h("div", { className: "dsv-empty" }, status === "pending" ? "正在打开会话…" : "该会话暂时没有可用的绑定");
			}
			if (typeof SessionProvider !== "function") return h("div", { className: "dsv-empty" }, "宿主未提供会话作用域");

			/* Why the host's own header is not rendered here (2026-11-07 调查结论):
			   宿主的会话头是 `conversation.header`，它由 `main.conversation` 那个面板条目
			   （ConversationRoot）声明并渲染；而 renderSlot 只允许渲染“本条目自己声明的子槽”，
			   直接调 renderSlot('conversation.header') 会抛
			   `slot 'conversation.header' is not declared by this entry's children`。
			   把该槽声明成自己的子槽更糟：槽名只能由属主声明一次，重复声明会让
			   web boot 整体失败（14 entries did not activate）。
			   直接渲染 ConversationRoot/ConversationHeader 组件则会抛
			   `useSession is not a function`——宿主的 prop 解析器会按条目契约注入
			   useSession/useProjection 这类钩子，而本插件的条目契约里没有它们，
			   我们也无法从外部伪造。所以每个栏里保留的是 conversation.content 工厂
			   （消息、输入框、上下文统计、费用明细都在里面），只缺最上面那一条
			   标题/模式/子智能体导航条。 */
			/* Route 3 (2026-11-07) 也失败了，记在这里免得再走一遍：
			   把 `main` 里 key=conversation 的那个面板组件（它自己就是
			   `({ renderSlot }) => renderSlot("main.conversation", {})`）拿到我们树里渲染，
			   想着让宿主替我们做会话作用域注入——不行。renderSlot 的授权是**按条目**绑定的：
			   我们拿到的是自己条目的 renderSlot，它只允许渲染本条目声明的子槽，于是抛
			   `slot 'main.conversation' is not declared by this entry's children`。
			   换句话说，宿主的面板条目自带的那个 renderSlot 只存在于它自己被渲染的那一次，
			   外部拿不到；而 `main.conversation` 的属主只能是 `conversation` 条目。
			   结论：在现有宿主契约下，插件无法把原生会话头挂进自己的栏里，
			   除非宿主把 `main` 改成会话作用域（或提供一个能在 SessionProvider 里
			   渲染 `conversation.header` 的入口）。 */
			return h(
				PaneBoundary,
				null,
				h(
					SessionProvider,
					{ session: reference },
					/* 视图条开启时用我们自己的 views 实现替换宿主默认的，
					   这样用户在本栏切换的视图才会真的生效；关掉时完全走宿主原路。 */
					viewBarOn === true
						? renderFactorySlot(CONTENT_FACTORY, { variant: "embedded", phase, hero }, { slots: { views: PaneViews } })
						: renderFactorySlot(CONTENT_FACTORY, { variant: "embedded", phase, hero })
				)
			);
		}

		/**
		 * The host's own session header — title, the 标准模式/费用明细/子智能体 chips and
		 * the 对话·轨迹·上下文·编队 tab strip. Rendering `conversation.session.header`
		 * inside the pane's session scope is what keeps those other plugins working
		 * in every pane and every tab; without it a pane loses them entirely.
		 */
		function SessionHead(props) {
			const { sessionId } = props;
			/* `renderSlot` is only allowed to render slots that the calling entry
			   declares as children, so the host's header slot is off limits (it
			   throws "slot 'conversation.header' is not declared by this entry's
			   children", and declaring it ourselves breaks the whole boot). The
			   registry entry, however, keeps the component itself — rendering that
			   component inside the pane's session scope gives every pane the real
			   title, the 标准模式/费用明细/子智能体 chips and the
			   对话/轨迹/上下文/编队 strip, i.e. whatever the other plugins do. */
			const host = react.useMemo(() => {
				try {
					const slots = service("slots");
					for (const name of ["conversation.header", "conversation.session.header"]) {
						const list = slots?.entriesOfSlot?.(name) ?? [];
						for (const entry of list) {
							if (typeof entry?.component === "function") return { name, component: entry.component };
						}
					}
				} catch (error) {
					if (typeof window !== "undefined") {
						window.__dsvHeadDebug = window.__dsvHeadDebug ?? [];
						window.__dsvHeadDebug.push({ error: String(error?.message ?? error) });
					}
				}
				return null;
			}, []);
			if (host === null) return null;
			/* The header component is a normal slot entry, so it expects the hook props
			   the host injects into every entry (useSessionStatus, useWorkspaces, …).
			   Pass ours through; anything it needs that we do not have will show up as
			   a HeadBoundary warning instead of taking the pane down. */
			const passed = HOST_SLOT_PROPS === null ? { sessionId } : { ...HOST_SLOT_PROPS, sessionId };
			return h("div", { className: "dsv-sessionhead" }, h(HeadBoundary, null, h(host.component, passed)));
		}

		/** A failed host header must never take the pane down with it. */
		class HeadBoundary extends react.Component {
			constructor(props) {
				super(props);
				this.state = { failed: false };
			}
			static getDerivedStateFromError() {
				return { failed: true };
			}
			componentDidCatch(error) {
				if (typeof console !== "undefined") console.warn("[split-view] 会话头渲染失败:", error);
			}
			render() {
				return this.state.failed === true ? null : this.props.children;
			}
		}

		/**
		 * The conversation subtree is the expensive part; memo keeps a tab's body
		 * from re-rendering when only the tab strip or the focus changed.
		 */
		const TabContentMemo = react.memo(TabContent);

		/**
		 * Which outer sliver of the CONVERSATION BODY the pointer sits in. Dropping
		 * there means "put a pane on that side" (the Hermes gesture); anywhere else —
		 * the whole tab strip, the middle of the body — means "open a tab here".
		 * The sliver is deliberately narrow: 25% of a half-width pane is a big target,
		 * so panes used to multiply whenever the pointer was merely near an edge.
		 * 2026-11-07 用户定的边界：外侧 20%（0.2 / 0.8）。
		 */
		function dropSideIn(node, clientX) {
			if (node === null || node === void 0) return null;
			try {
				const rect = node.getBoundingClientRect();
				if (!(rect.width > 0)) return null;
				const ratio = (clientX - rect.left) / rect.width;
				if (ratio < 0.2) return "left";
				if (ratio > 0.8) return "right";
				return null;
			} catch {
				return null;
			}
		}

		/**
		 * Paints the edge the drop would split on. The attribute lives on the pane
		 * element, so hovering the strip and hovering the body look the same.
		 */
		function markDropSide(event) {
			const origin = event.currentTarget;
			const pane = origin instanceof Element ? (origin.closest(".dsv-pane") ?? origin) : null;
			if (!(pane instanceof Element)) return null;
			/* Measure the conversation body, not the whole pane: the pane's rect includes
			   the 45 px tab strip, which would otherwise turn the strip's outer ends into
			   split targets again. */
			const area = pane.querySelector(".dsv-body") ?? pane;
			const side = dropSideIn(area, event.clientX);
			pane.dataset.drop = "1";
			if (side === null) delete pane.dataset.dropSide;
			else pane.dataset.dropSide = side;
			return side;
		}

		/**
		 * 指针是否正落在某个标签上。
		 *
		 * 为什么必须单独判：栏窄的时候（比如三栏时的 25%），标签群几乎贴着栏的左缘，
		 * 拖到**标签上**也会被 markDropSide 算成「左侧 20% 边缘」→ 误判成分栏。
		 * 标签是有明确边界的可交互元素，落在它上面就应该是「加进这一栏」。
		 */
		function tabAtPoint(headerEl, clientX, clientY) {
			if (headerEl === null || headerEl === void 0) return false;
			const strip = headerEl.querySelector(".dsv-tabs");
			if (strip === null) return false;
			for (const node of strip.querySelectorAll(".dsv-tab")) {
				if (node.getAttribute("data-ghost") === "1") continue;
				const rect = node.getBoundingClientRect();
				if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) return true;
			}
			return false;
		}

		/** 标签群实际占用的水平范围（第一个标签左缘 .. 最后一个标签右缘）。 */
		function tabSpanAt(headerEl) {
			if (headerEl === null || headerEl === void 0) return null;
			const strip = headerEl.querySelector(".dsv-tabs");
			if (strip === null) return null;
			const tabs = [...strip.querySelectorAll(".dsv-tab")].filter((node) => node.getAttribute("data-ghost") !== "1");
			if (tabs.length === 0) return null;
			const first = tabs[0].getBoundingClientRect();
			const last = tabs[tabs.length - 1].getBoundingClientRect();
			return { left: first.left, right: last.right };
		}

		/**
		 * 标签条上指针是否已经「拖出标签群」。群内（留 SLACK 容差）一律算排序——
		 * 否则想把标签排到第一个就没法拖了；只有拖出去才谈得上分栏。
		 * 2026-11-07 用户要求：同栏 a、b，把 b 拖远一些要能触发分栏。
		 */
		const TAB_SPAN_SLACK = 24;

		function outsideTabSpan(headerEl, clientX) {
			const span = tabSpanAt(headerEl);
			if (span === null) return false;
			return clientX < span.left - TAB_SPAN_SLACK || clientX > span.right + TAB_SPAN_SLACK;
		}

		/**
		 * 标签条上的插入位（0..标签数），按**移动前**的顺序算：取指针左侧最近的
		 * 那个标签的右半边作为分界。返回下标表示「插到第 index 个前面」。
		 */
		function insertIndexAt(headerEl, clientX) {
			if (headerEl === null || headerEl === void 0) return 0;
			const strip = headerEl.querySelector(".dsv-tabs");
			if (strip === null) return 0;
			const tabs = [...strip.querySelectorAll(".dsv-tab")].filter((node) => node.getAttribute("data-ghost") !== "1");
			for (let index = 0; index < tabs.length; index++) {
				const rect = tabs[index].getBoundingClientRect();
				if (clientX < rect.left + rect.width / 2) return index;
			}
			return tabs.length;
		}

		/**
		 * 清掉所有栏上的投放高亮标记（data-drop / data-dropSide）。
		 * 拖拽结束时统一扫一遍：只在 onDragLeave 里清不够——指针被拖到窗口外松手、
		 * 或落在没有处理器的元素上时，onDragLeave 不一定会来，蓝色虚线就永久留下了。
		 */
		function clearAllDropMarks() {
			for (const node of document.querySelectorAll(".dsv-pane[data-drop]")) {
				delete node.dataset.drop;
			}
			for (const node of document.querySelectorAll(".dsv-pane[data-drop-side]")) {
				delete node.dataset.dropSide;
			}
		}

		function clearDropSide(event) {
			const origin = event.currentTarget;
			const pane = origin instanceof Element ? (origin.closest(".dsv-pane") ?? origin) : null;
			if (!(pane instanceof Element)) return;
			delete pane.dataset.dropSide;
			delete pane.dataset.drop;
		}

		/**
		 * One tab in the shared strip. Middle-click and double-click both close it,
		 * which is what the Hermes-style workflow expects.
		 */
		function TabItem(props) {
			const { paneId, tabId, sessionId, label, runState, active, actions, locked, dblclickClose, paneHovered, width, showLabel, statusTick } = props;
			/* width 由 Chromium 算法给出（px）。不给就让 CSS 自己算（首帧/窄栏兜底）。 */
			const style = typeof width === "number" && width > 0 ? { flex: `0 0 ${width}px`, width: `${width}px` } : void 0;
			/* 锁定 = 关不掉。双击、中键、× 三条路全部拦住，只能右键解锁后再关。 */
			const requestClose = () => {
				if (locked) return;
				actions.closeTab(paneId, tabId);
			};
			const hint = locked
				? `${label} — 已锁定（右键解锁后才能关闭）`
				: `${label} — ${dblclickClose ? "双击或中键关闭" : "中键关闭"}（右键可锁定）`;
			return h(
				"div",
				{
					className: "dsv-tab",
					"data-active": active ? "1" : "0",
					"data-locked": locked ? "1" : "0",
					/* 非焦点栏里、鼠标正悬停在该栏 → 激活标签是「焦点所在未激活」 */
					"data-hover-pending": paneHovered === true && active ? "1" : "0",
					style,
					draggable: true,
					title: hint,
					onClick: () => actions.activateTab(paneId, tabId),
					onContextMenu: (event) => {
						event.preventDefault();
						event.stopPropagation();
						/* 右键标签 = 打开**宿主自己的**会话右键菜单：锁定/重命名/分叉/置顶/归档/复制会话 ID…
						   与侧栏会话行右键完全同一份（菜单项由宿主注册表提供，官方以后新增项会自动出现）。
						   「锁定标签」是我们注册进去的一项贡献（见 apply() 里的 contextMenus.register）。 */
						const menus = MENUS;
												if (typeof sessionId === "string" && menus !== null && typeof menus.open === "function") {
							try {
								menus.open({ kind: "session", value: { sessionId, displayTitle: label } }, { x: event.clientX, y: event.clientY });
								return;
							} catch (error) {
								console.warn("[split-view] 打开宿主会话菜单失败:", error);
							}
						}
						/* 空白标签（还没有会话）或老宿主拿不到 contextMenus：退回「直接切锁定」。 */
						actions.toggleLock(paneId, tabId);
					},
					onAuxClick: (event) => {
						if (event.button !== 1) return;
						event.preventDefault();
						event.stopPropagation();
						requestClose();
					},
					/* 滚轮关闭（照搬 Hermes 的手势）。锁定标签 requestClose 会自己拒绝。
					   只在标签条不滚动的前提下安全（否则滚轮本该滚动标签条）。 */
					onWheel: (event) => {
						if (event.deltaY === 0) return;
						event.preventDefault();
						event.stopPropagation();
						requestClose();
					},
					onDoubleClick: (event) => {
						event.preventDefault();
						if (!dblclickClose) return;
						requestClose();
					},
					onDragStart: (event) => {
						actions.tabDragStart(paneId, tabId);
						try {
							event.dataTransfer.effectAllowed = "move";
							event.dataTransfer.setData("text/plain", tabId);
						} catch {
							/* some browsers refuse synthetic payloads */
						}
					},
					onDragEnd: () => {
						actions.tabDragEnd();
					}
				},
				runState === "" || runState === void 0 ? null : h("span", { className: "dsv-dot", "data-run": runState }),
				locked ? h("span", { className: "dsv-tab-lock", "aria-hidden": "true" }, "🔒") : null,
				showLabel === false ? null : h("span", { className: "dsv-tab-label" }, label),
				locked
					? null
					: h(
					"button",
					{
						type: "button",
						className: "dsv-tab-close",
						title: "关闭标签",
						"aria-label": `关闭 ${label}`,
						onClick: (event) => {
							event.stopPropagation();
							event.preventDefault();
							requestClose();
						},
						onDoubleClick: (event) => {
							event.stopPropagation();
							event.preventDefault();
						},
						onAuxClick: (event) => {
							event.stopPropagation();
							event.preventDefault();
						}
					},
					"×"
				)
			);
		}

		const TabItemMemo = react.memo(TabItem);

		/**
		 * One pane's own tab strip. Every pane carries its strip so the tabs sit
		 * directly above the conversation they belong to, and the row of strips
		 * together lands on the app's 44px toolbar line. The workspace-wide buttons
		 * live at the end of the last strip, where the toolbar's own controls are.
		 */
		function PaneHeader(props) {
			const { pane, focused, isLast, paneCount, rowMap, actions, dragging, hover, narrow, paneHovered, statusTick } = props;
			/* 双击是否关闭标签由设置决定；prefs 变化要立刻生效。 */
			const prefsForTabs = usePrefs();
			/* 本栏正在同栏排序时，hover 里带插入位 index；其余情况为 null。 */
			const reorder = hover !== null && hover.kind === "reorder" && hover.paneId === pane.id ? hover : null;
			/* 标签宽度：按 Chromium 算法算好，逐个写死宽度。
			   ⚠️ 必须量 **header 的宽度**来推算可用宽度，**不能量 .dsv-tabs 自己**：
			   strip 的宽度又由标签宽度决定（flex 容器），量它会形成循环依赖 ——
			   标签变窄 → strip 变窄 → 算出的标签更窄 → 永远收敛到最小值，
			   结果就是「明明有地方却一个标题都不显示」。 */
			const [headW, setHeadW] = react.useState(0);
			react.useLayoutEffect(() => {
				/* ⚠️ 量 **所属栏 .dsv-pane** 的宽度，不能量 header：
				   header 是 position:fixed;width:0（宽度由 JS 反写），clientWidth 恒为 0，
				   会导致 headW=0 → 标签被压到 12px（标题和状态点都不渲染）。
				   .dsv-pane 的宽度由 flex 布局决定，与标签宽度无关，没有循环依赖。 */
				const paneEl = document.querySelector(`.dsv-pane[data-pane-id="${pane.id}"]`);
				const node = paneEl ?? headRef.current;
				if (node === null || node === void 0) return;
				const read = () => {
					const cs = getComputedStyle(node);
					const inner = node.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
					/* pane 本身没有 padding（padding 在 header 上），所以这里不额外扣。
					   header 的左右 padding 与 + 按钮宽度统一在下面 stripW 里扣。 */
					setHeadW(Math.max(0, Math.round(inner)));
				};
				read();
				const observer = typeof ResizeObserver === "function" ? new ResizeObserver(read) : null;
				if (observer !== null) observer.observe(node);
				window.addEventListener("resize", read);
				return () => {
					if (observer !== null) observer.disconnect();
					window.removeEventListener("resize", read);
				};
			}, [pane.id]);
			/* 扣掉「+ 按钮」占宽。可拖窗口区（44px）只在**非最后一栏**要额外扣：
			   最后一栏的 padding-right 已经是窗口按钮的让位区，本身就是空白，
			   再扣 44 会把标签挤到只剩 24px。 */
			/* 可用宽度 = 栏宽 − header 左右 padding(16) − + 按钮(24) − 拖拽区。
			   最后一栏：header 的 padding-right 是 145（窗口按钮让位），它已经从
			   pane 宽度里被 header 的 padding 吃掉，所以再扣 145；不再扣 44 拖拽区
			   （那块让位区本身就是可拖窗口区）。 */
			const CHROME_W = 16 + 24;
			const stripW = Math.max(0, headW - CHROME_W - (isLast ? 145 : 44));
			/* 每个标签的标题：渲染进标签和「算宽度」共用同一份结果（否则两处逻辑会漂） */
			const tabLabels = pane.tabs.map((tab) => {
				const row = tab.sessionId === null ? void 0 : rowMap.get(tab.sessionId);
				return tab.sessionId === null || row?.blank === true
					? "新会话"
					: row === void 0
						? "已失效会话"
						: rowLabel(row) || "未命名会话";
			});
			const tabWidths = layoutTabWidths(stripW, pane.tabs.length, tabLabels.map(tabIdealWidth));
			/* 标签条浮在窗口顶端那一行：fixed 不受宿主容器 overflow 裁剪；left/width 跟着
			   所属栏的实时几何走（分隔条拖动、侧边栏折叠、加减栏都靠 ResizeObserver 同步）。 */
			const headRef = react.useRef(null);
			react.useLayoutEffect(() => {
				const head = headRef.current;
				if (head === null) return;
				const paneEl = head.closest(".dsv-pane");
				if (paneEl === null) return;
				const sync = () => {
					const rect = paneEl.getBoundingClientRect();
					const left = `${Math.round(rect.left)}px`;
					const width = `${Math.round(rect.width)}px`;
					if (head.style.left !== left) head.style.left = left;
					if (head.style.width !== width) head.style.width = width;
				};
				/* 栏宽/位置变了要立刻跟：ResizeObserver 回调要等一帧，而拖拽事件可能在
				   同一帧里就派发过来，那时 head 还是旧宽度 → 边缘判定用错 rect。 */
				sync();
				/* 低频兜底：栏顺序变化、侧栏折叠动画这类「位置变了但容器尺寸没变」的情况
				   ResizeObserver 不触发。500ms 一次开销可忽略；
				   以前这里是 requestAnimationFrame **每帧**同步 —— 每帧 getBoundingClientRect 强制布局，
				   而且 left/width 一变就改 style，会反复触发 Chromium 重算窗口的 draggable regions。
				   重算期间系统可能短暂不把标签条当标题栏，表现就是「双击最大化时灵时不灵」。 */
				const syncTimer = window.setInterval(sync, 500);
				const observer = typeof ResizeObserver === "function" ? new ResizeObserver(sync) : null;
				if (observer !== null) {
					observer.observe(paneEl);
					if (paneEl.parentElement !== null) observer.observe(paneEl.parentElement);
				}
				window.addEventListener("resize", sync);
				return () => {
					if (observer !== null) observer.disconnect();
					window.clearInterval(syncTimer);
					window.removeEventListener("resize", sync);
				};
			}, []);
			return h(
				"div",
				{
					ref: headRef,
					className: "dsv-paneheader",
					"data-focus": focused ? "1" : "0",
					onDragOver: (event) => {
						if (drag.sessionId === null && drag.tab === null) return;
						event.preventDefault();
						event.stopPropagation();
						/* 不显式设 dropEffect：与拖拽源设置的 effectAllowed 不一致时浏览器会显示禁止图标 */
						/* ① 拖的是**本栏自己的标签**：两种动作按「有没有拖出标签群」区分——
						   群内 = 排序（画插入竖线）；拖出群且落进左右边缘 20% = 分栏（画半屏预览）。
						   都拖出去很远了还不给分栏，用户会以为分栏坏了。 */
						if (drag.tab !== null && drag.tab.paneId === pane.id) {
							/* 只有一栏、且这栏只有这一个标签：分出去等于没变化，别给预览。 */
							const canSplit = !(paneCount === 1 && pane.tabs.length === 1);
							const far = canSplit && !narrow && outsideTabSpan(event.currentTarget, event.clientX);
							if (far) {
								const side = narrow ? null : markDropSide(event);
								if (side !== null) {
									actions.setHover({ paneId: pane.id, side, kind: "split" });
									return;
								}
							}
							clearDropSide(event);
							const index = insertIndexAt(event.currentTarget, event.clientX);
							actions.setHover({ paneId: pane.id, side: null, kind: "reorder", index });
							return;
						}
						/* ② 会话已经在本栏（从侧栏拖过来）或标签来自别的栏 → 按原规则算左右边缘。 */
						const side = narrow ? null : markDropSide(event);
						if (narrow) clearDropSide(event);
						const sameSession =
							drag.sessionId !== null && pane.tabs.some((candidate) => candidate.sessionId === drag.sessionId);
						/* 已经在这一栏的会话再拖回来 = 什么也不会发生，别显示「加到这一栏」。
						   markDropSide 已经给 pane 打了 data-drop=1（蓝色虚线），必须在这里清掉，
						   否则虚线会一直挂在那儿。 */
						/* 已在本栏的会话：中间、边缘都做不了任何事（dropOnPane 会因 findSession 命中而
						   直接 return），所以两种位置都不给预览，别画一个骗人的半屏。 */
						if (sameSession) {
							clearDropSide(event);
							actions.setHover(null);
							return;
						}
						/* 已经到 MAX_PANES：边缘分不出新栏，给「最多 N 栏」提示而不是半屏预览。 */
						if (side !== null && paneCount >= MAX_PANES) {
							clearDropSide(event);
							actions.setHover({ paneId: pane.id, side: null, kind: "limit" });
							return;
						}
						actions.setHover({ paneId: pane.id, side, kind: side === null ? "tab" : "split" });
					},
					onDragLeave: (event) => {
						const node = event.currentTarget;
						if (event.relatedTarget instanceof Node && node.contains(event.relatedTarget)) return;
						clearDropSide(event);
						actions.setHover(null);
					},
					onDrop: (event) => {
						event.preventDefault();
						event.stopPropagation();
						if (drag.tab !== null && drag.tab.paneId === pane.id) {
							/* 拖出标签群并落进边缘 20% → 在本栏这一侧分出新栏；否则就是排序。 */
							/* 只有一栏、且这栏只有这一个标签：分出去等于没变化，别给预览。 */
							const canSplit = !(paneCount === 1 && pane.tabs.length === 1);
							const far = canSplit && !narrow && outsideTabSpan(event.currentTarget, event.clientX);
							if (far) {
								const sideNow = narrow ? null : markDropSide(event);
								if (sideNow !== null) {
									clearDropSide(event);
									actions.setHover(null);
									actions.dropOnPane(pane.id, sideNow);
									return;
								}
							}
							const index = insertIndexAt(event.currentTarget, event.clientX);
							clearDropSide(event);
							actions.reorderTab(pane.id, drag.tab.tabId, index);
							return;
						}
						/* 落在标签上 = 加进这一栏，不判左右边缘（窄栏时标签贴着边缘，否则会误判分栏）。 */
						const onTab = tabAtPoint(event.currentTarget, event.clientX, event.clientY);
						const side = onTab || narrow ? null : markDropSide(event);
						clearDropSide(event);
						const sameSession =
							drag.sessionId !== null && pane.tabs.some((candidate) => candidate.sessionId === drag.sessionId);
						actions.setHover(null);
						// 已经在这一栏的会话：拖回来不做事，只清状态。
						if (sameSession) {
							actions.tabDragEnd();
							return;
						}
						// 边缘 = 分栏，中间 = 加标签（与正文一致）
						actions.dropOnPane(pane.id, side);
					}
				},
				// Only the tabs scroll; the strip's own buttons stay put at the right
				// edge, so they never slide out of reach when a pane has many tabs.
				h(
					"div",
					{ className: "dsv-tabs" },
					pane.tabs.flatMap((tab, tabIndex) => {
						const row = tab.sessionId === null ? void 0 : rowMap.get(tab.sessionId);
						/* 刚建出来的会话，宿主给它的标题是工作区名（如 default-workspace），
						   看着不像“新会话”。blank 会话一律显示「新会话」，与侧栏新建一致；
						   等用户发了第一句话、宿主生成标题后再显示真标题。 */
						const label = tabLabels[tabIndex];
						const width = tabWidths[tabIndex];
						/* 宽度分级显示（同 Chromium 的 TabController）：
						   < TAB_MIN+18 → 只留图标位，标题完全隐藏
						   < TAB_CROSSOVER → 标题显示但会被省略号截断
						   ≥ TAB_CROSSOVER → 完整标题 */
						/* 阈值别设太高：Chromium 是「放不下才隐藏」。只要不是极限压缩就给标题，
						   窄了靠省略号，用户至少知道是哪个。 */
						const showLabel = width === void 0 || width >= 30;
						const node = h(TabItemMemo, {
							key: tab.id,
							paneId: pane.id,
							tabId: tab.id,
							sessionId: tab.sessionId,
							label,
							width,
							showLabel,
							/* 用户 2026-11-07 设计：
							   标签页上的状态点只在「需要提醒你」时出现 ——
							   · 该标签是本栏激活标签且本栏是焦点栏 → 你正在看它，不显示点
							   · 进行中 → 绿点（呼吸）
							   · 曾跑完但你还没看过 → 橙点（未读）
							   焦点判断放在 TabItem 里做不了（它不知道栏是否焦点），
							   所以这里直接算好，传 runState。 */
							/* 标签页状态点：**与侧栏同源** —— 直接读宿主给该会话渲染的
							   StateDot 的 data-state（done / warning / error / idle），
							   不再自己推 running/unread。这样两处语义永远一致。 */
							runState: (() => {
								const sid = tab.sessionId;
								if (typeof sid !== "string" || sid === "") return "";
								/* 正在看它（焦点栏的激活标签）→ 不显示点，避免重复提醒。 */
								if (focused === true && pane.activeTabId === tab.id) return "";
								return hostStateOf(sid);
							})(),
							active: pane.activeTabId === tab.id,
							locked: tab.locked === true,
							dblclickClose: prefsForTabs.dblclickClose !== false,
							paneHovered: paneHovered === true,
							statusTick,
							actions
						});
						/* 同栏排序时，在插入位画一条竖线（插到第 tabIndex 个前面）。 */
						const caretHere = reorder !== null && reorder.index === tabIndex;
						return caretHere
							? [h("span", { className: "dsv-caret", key: `caret-${tab.id}`, "aria-hidden": "true" }), node]
							: [node];
					}),
					// 插到最末尾：竖线放在最后一个标签之后。
					reorder !== null && reorder.index === pane.tabs.length
						? h("span", { className: "dsv-caret", key: "caret-end", "aria-hidden": "true" })
						: null,
					// 松手预览：这一栏会多出一个标签（不会新开栏）。
					hover !== null && hover.kind === "tab"
						? h("span", { className: "dsv-tab", "data-ghost": "1", key: "ghost-tab" }, "松手：加到这一栏")
						: hover !== null && hover.kind === "limit"
							? h("span", { className: "dsv-tab dsv-limit", key: "limit-tab" }, `最多 ${MAX_PANES} 栏`)
							: null
				),
				h(
					"button",
					{
						type: "button",
						className: "dsv-btn",
						title: "新建标签",
						"aria-label": "新建标签",
						onClick: () => actions.newTab(pane.id)
					},
					"+"
				),
				h("span", { className: "dsv-spacer" })
			);
		}

		/**
		 * One pane: its own tab strip on top of the active tab's conversation.
		 */
		function Pane(props) {
			const { pane, focused, isLast, paneCount, rowMap, sessions, renderFactorySlot, SessionProvider, renderSlot, actions, dragging, hover, narrow, statusTick, viewBar } = props;
			/* 鼠标悬停在本栏 → 若是非焦点栏，它的激活标签进入「焦点所在但未激活」状态：
			   用来告诉用户「点这里就会把焦点切过来」。用 pointerenter/leave 而不是
			   mousemove，避免每帧 setState。 */
			const [hovered, setHovered] = react.useState(false);
			const active = pane.tabs.find((tab) => tab.id === pane.activeTabId) ?? pane.tabs[0];
			const sessionId = active?.sessionId ?? null;
			const row = sessionId === null ? void 0 : rowMap.get(sessionId);
			const hero = row === void 0 || row.blank === true;

			const wantInline = viewBar.enabled === true && viewBar.placement === "top" && sessionId !== null;
			const [vbInline, setVbInline] = react.useState(true);
			const [rightAvail, setRightAvail] = react.useState(0);
			/* 「一行站得下吗」必须用**真实需求宽**判，不能用常数估（见 check() 里的注释）。 */
			const [vbNeedAll, setVbNeedAll] = react.useState(0);
			const [rightNeed, setRightNeed] = react.useState(0);
			const reportVbNeed = react.useCallback((width) => {
				setVbNeedAll((prev) => (Math.abs(prev - width) < 1 ? prev : width));
			}, []);
			const reportRightNeed = react.useCallback((width) => {
				setRightNeed((prev) => (Math.abs(prev - width) < 1 ? prev : width));
			}, []);
			react.useEffect(() => {
				const PAD = 36; /* hostbar 左右 padding(10+10) + 两个 8px 间隔 */
				const CORNER = 42; /* 右栏开关：按钮宽 34 + 左间隔 8 */
				const MORE = 26; /* 按钮组溢出时的「⋯」：宿主的「更多操作」永远被收进我们这颗，所以它常驻，判一行时要给它留位 */
				const SAFETY = 8; /* 亚像素/字体回退的容差 */
				const check = () => {
					const paneEl = document.querySelector(`.dsv-pane[data-pane-id="${pane.id}"]`);
					if (paneEl === null) return;
					const paneW = paneEl.getBoundingClientRect().width;
					if (!(paneW > 10)) return;
					const left = paneEl.querySelector(".dsv-hostbar-left");
					const leftW = left === null ? 0 : left.scrollWidth;
					/* 切换条的完整需求宽：由 ViewBar 用 canvas 量好上报（与当前折叠状态无关）。
					   ⚠️ 不能拿 vbTabs.scrollWidth：切换条独占一行时被 flex 撑满整栏，
					   scrollWidth 等于整栏宽，判据永远算出「放不下」，永远两行。
					   也没法拿「当前可见标签宽度」：那样会「因为已经折叠了所以算得下」，
					   折叠态自我维持，永远不换行。 */
					let vbW = vbNeedAll;
					if (!(vbW > 0)) {
						const vbTabs = paneEl.querySelector(".dsv-viewtabs");
						if (vbTabs !== null) {
							const tabEls = vbTabs.querySelectorAll(".dsv-vtab");
							for (const tab of tabEls) vbW += tab.getBoundingClientRect().width;
							if (tabEls.length > 1) vbW += (tabEls.length - 1) * 14;
						}
					}
					/* 按钮组同样用「全显」真实宽度（CollapsedActions 上报）。
					   ⚠️ 以前用常数 RIGHT_MIN=96 估它，而真实 6 颗按钮要 200+，
					   于是「站不下」被判成「一行」，按钮被一颗颗收进 ⋯ ——
					   用户看到的是硬挤，不是「分两行」（2026-11-08 实测定位）。 */
					const rightW = rightNeed > 0 ? rightNeed : 96;
					/* ① 一行：标题 + 切换条完整 + 按钮组完整 + 右栏开关 都放得下 → 一行；
					   ② 否则两行：切换条降到第二行、整行铺满。 */
					const inline = wantInline === true && leftW + vbW + rightW + PAD + CORNER + MORE + SAFETY <= paneW;
					setVbInline((prev) => (prev === inline ? prev : inline));
					/* ③ 按钮组可用宽：一行时扣掉切换条占的宽度，两行时它吃满本行剩余
					   （但同样要给 padding、右栏开关、「⋯」让位，否则最后一颗会被裁在栏外）。 */
					const nextAvail = Math.max(
						60,
						Math.round(paneW - leftW - (inline === true ? vbW : 0) - PAD - CORNER - MORE - SAFETY)
					);
					setRightAvail((prev) => (prev === nextAvail ? prev : nextAvail));
				};
				check();
				const target = document.querySelector(`.dsv-pane[data-pane-id="${pane.id}"]`);
				const observer = typeof ResizeObserver === "function" ? new ResizeObserver(check) : null;
				if (observer !== null && target !== null) observer.observe(target);
				const timer = window.setInterval(check, 300);
				window.addEventListener("resize", check);
				return () => {
					window.clearInterval(timer);
					if (observer !== null) observer.disconnect();
					window.removeEventListener("resize", check);
				};
			}, [pane.id, wantInline, vbNeedAll, rightNeed]);

			return h(
				"div",
				{
					className: "dsv-pane",
					"data-pane-id": pane.id,
					/* 宿主插件（如 dsh-better-sidebar 的底部面板）用
					   `#root [data-slot="main.conversation"]` 找「中间会话列」来对齐定位。
					   我们的面板替换了 main 槽，原生那个节点没了 → 它找不到中心列 →
					   底部面板宽被算成 0、visibility:hidden，看起来「点了没反应」。
					   把焦点栏标成 main.conversation，宿主就能量到正确矩形。
					   （实测：标上后底部面板 left:280px right:576px，宽度 424px 正常显示） */
					"data-slot": focused ? "main.conversation" : void 0,
					"data-focus": focused ? "1" : "0",
					/* 非焦点栏 + 鼠标悬停 = 「焦点所在但未激活」：该栏的激活标签用另一种样式，
					   提示「点这里焦点就过来」。 */
					"data-hovered": !focused && hovered ? "1" : "0",
					style: narrow ? void 0 : { flex: `${pane.weight} 1 0` },
					onPointerEnter: () => { if (!focused) setHovered(true); },
					onPointerLeave: () => { if (hovered) setHovered(false); },
					onPointerDownCapture: () => actions.focusPane(pane.id),
					onDragOver: (event) => {
						if (drag.sessionId === null && drag.tab === null) return;
						/* 标签条那一条高度内的事件归 PaneHeader 管（它自己会 stopPropagation），
						   万一冒到这里，别再算一遍边缘——窄栏时会把「拖到标签上」误判成分栏。 */
						if (event.target instanceof Element && event.target.closest(".dsv-paneheader") !== null) return;
						event.preventDefault();
						/* 不显式设 dropEffect：与拖拽源设置的 effectAllowed 不一致时浏览器会显示禁止图标 */
						/* Stacked (narrow) panes have no usable left/right edge. */
						const side = narrow ? null : markDropSide(event);
						if (narrow) clearDropSide(event);
						// Preview BEFORE the release: edge = new pane on that side,
						// anywhere else inside the body = just another tab here.
						/* 拖的是本栏自己的标签、或本栏已有的会话：落到正文中间什么也不会变，
						   所以不显示「松手：加到这一栏」；边缘（分栏）仍然给预览，那是有意义的动作。 */
						const ownTab = drag.tab !== null && drag.tab.paneId === pane.id;
						const sameSession =
							drag.sessionId !== null && pane.tabs.some((candidate) => candidate.sessionId === drag.sessionId);
						if (sameSession) {
							clearDropSide(event);
							actions.setHover(null);
							return;
						}
						if (side === null && ownTab) {
							clearDropSide(event);
							actions.setHover(null);
							return;
						}
						/* 同栏唯一标签拖到边缘 = 空操作（dropTab 会忽略），别给分栏预览。 */
						if (side !== null && ownTab && paneCount === 1 && pane.tabs.length === 1) {
							clearDropSide(event);
							actions.setHover(null);
							return;
						}
						/* 满栏：边缘带只给「最多 N 栏」提示，不画半屏预览。 */
						if (side !== null && paneCount >= MAX_PANES) {
							clearDropSide(event);
							actions.setHover({ paneId: pane.id, side: null, kind: "limit" });
							return;
						}
						actions.setHover({ paneId: pane.id, side, kind: side === null ? "tab" : "split" });
					},
					onDragLeave: (event) => {
						const node = event.currentTarget;
						if (event.relatedTarget instanceof Node && node.contains(event.relatedTarget)) return;
						clearDropSide(event);
						actions.setHover(null);
					},
					onDrop: (event) => {
						event.preventDefault();
						event.stopPropagation();
						if (event.target instanceof Element && event.target.closest(".dsv-paneheader") !== null) return;
						const side = narrow ? null : markDropSide(event);
						clearDropSide(event);
						actions.setHover(null);
						/* 已在本栏的会话拖进来 = 空操作。 */
						if (drag.sessionId !== null && pane.tabs.some((candidate) => candidate.sessionId === drag.sessionId)) {
							actions.tabDragEnd();
							return;
						}
						/* 同栏唯一标签拖到边缘 = 空操作，别真的走 dropOnPane。 */
						if (side !== null && drag.tab !== null && drag.tab.paneId === pane.id && paneCount === 1 && pane.tabs.length === 1) {
							actions.tabDragEnd();
							return;
						}
						actions.dropOnPane(pane.id, side);
					}
				},
				h(PaneHeader, { pane, focused, isLast, paneCount, rowMap, actions, dragging, hover, narrow, statusTick, paneHovered: !focused && hovered }),
				/* ⚠️ 不要按「是不是空白新会话」隐藏：宿主原生对空白会话只隐藏**标签行**
				   （showTabs = !hideChrome && tabs.length > 1），标题/标准模式/费用明细
				   这些按钮照常显示。之前按 hero 隐藏，导致新建标签（空白会话）时整条消失，
				   表现为「单标签有时有、多标签时又没有」。 */
				/* 空白标签（还没发过消息，sessionId 为 null）也保留这条：
				   否则新建标签后整条消失，看起来像「有时有有时没有」。
				   兜底会话取列表里的第一个，只用于让按钮和标题有数据可读。 */
				viewBar.hostBar === true
					? h(HostBar, {
							sessionId: sessionId ?? fallbackSessionId(sessions),
							showChrome: true,
							sessions,
							SessionProvider,
							/* top 模式的切换条交给 HostBar 内部渲染，才能和标题/标准模式/子智能体
							   排在同一行；放不下由 HostBar 自己换行。没有 HostBar 时退化成一整行。 */
							viewBar:
								vbInline === true && wantInline === true
									? h(ViewBar, { sessionId, placement: "top", prefsState: viewBar.state, onNeed: reportVbNeed })
									: null,
							rightAvail,
							onRightNeed: reportRightNeed
						})
					: vbInline === true && wantInline === true
						? h(ViewBar, { sessionId, placement: "top", prefsState: viewBar.state, onNeed: reportVbNeed })
						: null,
				/* 放不下 → 切换条降为独立第二行（装在会话头下面）。 */
				wantInline === true && vbInline !== true
					? h(ViewBar, { sessionId, placement: "top", prefsState: viewBar.state, onNeed: reportVbNeed })
					: null,
				h(
					"div",
					{ className: "dsv-body" },
					h(TabContentMemo, {
						key: `${active?.id ?? "none"}::${sessionId ?? "blank"}`,
						sessionId,
						hero,
						sessions,
						renderFactorySlot,
						SessionProvider,
						renderSlot,
						viewBarOn: viewBar.enabled === true
					})
				),
				/* bottom 模式不再画在栏内底部 —— 它由 StatusBar 挂到底栏左边
				   （用户要求：切换条在底部时搬到最底那行的左侧，统计信息挪右边）。 */
				// 松手前就把结果画出来：这一侧会出现一栏、占一半宽。
				hover !== null && hover.kind === "split" ? h(DropPreview, { side: hover.side }) : null,
				hover !== null && hover.kind === "limit" ? h("div", { className: "dsv-limit-toast" }, `最多支持 ${MAX_PANES} 栏`) : null
			);
		}

		/**
		 * The ghost the pointer drags around before release: it shows the pane that
		 * WOULD be created on this side, at the width it would take, plus the exact
		 * wording of what release does. Purely visual — pointer-events are off.
		 */
		function DropPreview(props) {
			const { side } = props;
			return h(
				"div",
				{ className: "dsv-droppreview", "data-side": side === "left" ? "left" : "right", "aria-hidden": "true" },
				h(
					"div",
					{ className: "dsv-droppreview-mini" },
					h("span", { style: { width: "30px" }, "data-new": side === "left" ? "1" : "0" }),
					h("span", { style: { width: side === "left" ? "54px" : "30px" }, "data-new": side === "right" ? "1" : "0" })
				),
				h("span", { className: "dsv-droppreview-label" }, side === "left" ? "松手：在这一栏左侧新开一栏" : "松手：在这一栏右侧新开一栏")
			);
		}

		const PaneMemo = react.memo(Pane);

		function formatTokens(value) {
			if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "0";
			if (value >= 1e6) return `${(value / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
			if (value >= 1e3) return `${(value / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
			return String(Math.round(value));
		}

		function formatDuration(ms) {
			if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "";
			const minutes = Math.round(ms / 60000);
			if (minutes < 60) return `${minutes}m`;
			const hours = Math.floor(minutes / 60);
			const rest = minutes % 60;
			return rest > 0 ? `${hours}h${rest}m` : `${hours}h`;
		}

		/**
		 * Hermes-style status line for the focused tab: context fill, token usage and
		 * timing straight out of the session projections the host already publishes.
		 */
		function StatusBar(props) {
			const { state, sessions, viewBar } = props;
			// The host's own composer dock (cost meter + 上下文百分比 + 轮/步 · tok/s) is
			// cramped inside a narrow pane. We MOVE the focused pane's real row into the
			// bar (buttons stay clickable), and hide the other panes' copies.
			const [dockHostRef, hasDock] = useDockHost(state);
			// The status line is the only part that wants live numbers, so it keeps its
			// own subscription instead of dragging every pane along on each token.
			const rows = sessionRows(useSessionList(sessions));
			const pane = state.panes.find((candidate) => candidate.id === state.focusPaneId) ?? state.panes[0];
			const tab = pane === void 0 ? void 0 : pane.tabs.find((candidate) => candidate.id === pane.activeTabId) ?? pane.tabs[0];
			const row = tab?.sessionId ? rows.find((candidate) => candidate.id === tab.sessionId) : void 0;
			const values = row?.projectionValues ?? {};
			/* The list projection only publishes tokenUsage / userQuestions /
			   subagentTiming; contextPressure lives inside a session scope and cannot
			   be read from out here, so the bar reports what actually exists. */
			const usage = values.tokenUsage ?? {};
			const questions = values.userQuestions ?? {};
			const timing = values.subagentTiming ?? {};

			const items = [];
			const rounds = (Array.isArray(questions.settled) ? questions.settled.length : 0) + (Array.isArray(questions.active) ? questions.active.length : 0);
			if (!hasDock) {
				// Fallback（空白页 / 该会话还没挂上宿主统计行时）：用 projection 里的数字顶着。
				if (rounds > 0) items.push(h("span", { className: "dsv-stat", key: "rounds" }, h("span", { className: "dsv-stat-label" }, "轮次"), h("span", null, String(rounds))));
				const uncached = usage.uncachedInputTokens ?? 0;
				const cached = usage.cacheReadTokens ?? 0;
				const used = uncached + cached + (usage.outputTokens ?? 0);
				if (used > 0) items.push(h("span", { className: "dsv-stat", key: "use" }, h("span", { className: "dsv-stat-label" }, "用量"), h("span", null, `${formatTokens(used)} tok`)));
				if (cached > 0 && uncached + cached > 0) {
					const rate = Math.round((cached / (cached + uncached)) * 100);
					items.push(h("span", { className: "dsv-stat", key: "cache" }, h("span", { className: "dsv-stat-label" }, "缓存命中"), h("span", null, `${rate}%`)));
				}
			}
			const spent = formatDuration(timing.settledMs);
			if (spent !== "") items.push(h("span", { className: "dsv-stat", key: "time" }, h("span", { className: "dsv-stat-label" }, "智能体"), h("span", null, spent)));
			if (items.length === 0 && !hasDock) items.push(h("span", { className: "dsv-stat", key: "hint" }, "没有可用的统计"));

			/* 底栏布局随视图切换条的位置变（用户口径 2026-11-08）：
			     · 切换条在「顶部」 → 底栏保持原样，统计信息**居中**
			     · 切换条在「底部」 → 切换条搬到**底栏左边**，统计信息整体**靠右**
			   两件事解耦：切换条属于「栏内的导航」，统计信息属于「本栏汇总」。 */
			const vb = viewBar ?? { enabled: false, placement: "top", state: {} };
			const focusSessionId = typeof tab?.sessionId === "string" ? tab.sessionId : null;
			const vbInBar = vb.enabled === true && vb.placement === "bottom" && focusSessionId !== null;
			return h(
				"div",
				{ className: "dsv-statusbar", "data-vb": vbInBar ? "bottom" : "top" },
				vbInBar
					? h("div", { className: "dsv-vb-left" }, h(ViewBar, { sessionId: focusSessionId, placement: "bottom", prefsState: vb.state }))
					: null,
				h("div", { className: "dsv-statgroup" }, h("div", { className: "dsv-dockhost", ref: dockHostRef }), items)
			);
		}

		/**
		 * Moves the FOCUSED pane's real composer dock row (`.GRgSLq_dock`: 轮步・tok/s、
		 * 费用明细、缓存命中、上下文已用％、本会话费用…) into the workspace status bar,
		 * instead of copying its text.
		 *
		 * 2026-11-07 用户反馈：以前这个行在每栏里，能点「费用明细」「上下文占用」看详情；
		 * 我最早是「隐藏原行 + 抄文本」，于是按钮全没了。现在直接把宿主那一行 DOM 节点
		 * 搬进底栏（同一个 React root，事件委托照旧），所以按钮、弹层、悬停全部还原；
		 * 非焦点栏的行仍然隐藏，底栏只显示焦点栏这一份。
		 * 搬走后宿主重渲染若把这一行换掉，轮询会把新的节点再搬进来。
		 */
		function useDockHost(state) {
			const hostRef = react.useRef(null);
			const [hasDock, setHasDock] = react.useState(false);
			const focusId = state.focusPaneId;
			react.useEffect(() => {
				let moved = null;
				let disposed = false;
				const detach = () => {
					if (moved === null) return;
					const { node, parent, next } = moved;
					moved = null;
					try {
						if (parent !== null && parent.isConnected === true) {
							parent.insertBefore(node, next !== null && next.parentNode === parent ? next : null);
						}
					} catch {}
				};
				/**
				 * True while we still hold the focused pane's row inside our bar.
				 *
				 * Once the row lives in the status bar the focused pane no longer
				 * contains it, so a plain rescan finds nothing and drags it back into
				 * the pane — and the next tick moves it out again. That two-per-second
				 * hop is what the user saw as 「底部一直在跳」. So: if we hold it, do
				 * nothing at all; only look for a row when we don't hold one.
				 */
				const holds = () => moved !== null && moved.node.isConnected === true && moved.node.parentNode === hostRef.current;
				/**
				 * 底栏里只许有「当前焦点栏那一行」。
				 *
				 * 宿主重渲染时会把统计行换成新节点：旧节点被 React 抛弃，却仍留在我们
				 * 的容器里（它已经不归 React 管），于是底栏会同时显示两行、甚至越攒越多
				 * —— 用户报的「底部显示两个或多个」就是这个。所以每次扫描先把容器里
				 * 多余的子节点清掉，只留手里这一行。
				 */
				const prune = (host) => {
					for (const child of Array.from(host.children)) {
						if (moved !== null && child === moved.node) continue;
						try {
							host.removeChild(child);
						} catch {}
					}
				};
				let observedHost = null;
				let observer = null;
				const watch = (host) => {
					if (observedHost === host) return;
					if (observer !== null) observer.disconnect();
					observedHost = host;
					if (typeof MutationObserver !== "function") return;
					observer = new MutationObserver(() => {
						if (disposed) return;
						prune(host);
					});
					observer.observe(host, { childList: true });
				};
				/**
				 * 把栏内除了「我们手里那一行」之外的统计行全部藏掉。
				 *
				 * 宿主重渲染会造出新的统计行节点，我们搬走的是旧节点、它管不着新节点，
				 * 于是同一栏里会同时出现「栏内可见的一份」+「底栏那一份」。必须每轮都清。
				 */
				const hideStrayRows = (host) => {
					const keep = moved !== null ? moved.node : null;
					for (const pane of Array.from(document.querySelectorAll(".dsv-pane"))) {
						for (const dock of Array.from(pane.querySelectorAll(".cm-stat-dock"))) {
							const row = dock.parentElement?.parentElement ?? null;
							if (row === null || row === keep) continue;
							if (host.contains(row)) continue;
							if (row.style.display !== "none") row.style.display = "none";
						}
					}
				};

				const scan = () => {
					if (disposed) return;
					const host = hostRef.current;
					if (host === null) return;
					watch(host);
					prune(host);
					/* 关键：即使已经稳住了焦点行（holds()），也必须继续隐藏「栏内其它行」。
					   宿主在焦点栏里重渲染时会**新建一份**统计行，而我们手里那一份已经搬进底栏、
					   与它无关 —— 于是同一栏里出现两份可见的行：一份在栏内（y≈770），
					   一份在底栏（y≈796）。用户看到的就是「底栏数据和栏内数据重复显示」。
					   旧代码在 holds() 时直接 return，漏掉了这一步隐藏。 */
					if (holds()) {
						hideStrayRows(host);
						return;
					}
					// The host re-rendered and swapped the row out from under us: forget
					// the stale node and pick the fresh one up below.
					if (moved !== null && moved.node.isConnected !== true) moved = null;
					let target = null;
					for (const pane of Array.from(document.querySelectorAll(".dsv-pane"))) {
						const focusedPane = pane.getAttribute("data-focus") === "1";
						// 同一栏里也可能出现多行（宿主重建后新旧并存）：只留第一行做焦点行，
						// 其余全部隐藏，绝不把第二行搬进底栏。
						const rows = [];
						for (const dock of Array.from(pane.querySelectorAll(".cm-stat-dock"))) {
							const row = dock.parentElement?.parentElement ?? null;
							if (row !== null && rows.indexOf(row) < 0) rows.push(row);
						}
						for (const row of rows) {
							if (focusedPane && target === null) target = row;
							else if (row.style.display !== "none") row.style.display = "none";
						}
					}
					if (target === null) {
						setHasDock(false);
						return;
					}
					if (moved !== null && moved.node === target && target.parentNode === host) return;
					// 换焦点时先把上一栏那行原地藏掉再搬新的：否则它会以“可见”状态
					// 留在旧栏里（底栏一份 + 旧栏一份 = 用户看到的“显示两个”）。
					const previous = moved;
					detach();
					if (previous !== null) {
						try {
							previous.node.style.display = "none";
						} catch {}
					}
					if (target.parentNode !== host) {
						moved = { node: target, parent: target.parentNode, next: target.nextSibling };
						try {
							host.appendChild(target);
						} catch {
							moved = null;
							setHasDock(false);
							return;
						}
					}
					if (target.style.display !== "") target.style.display = "";
					setHasDock(true);
				};
				scan();
				const timer = setInterval(scan, 500);
				return () => {
					disposed = true;
					clearInterval(timer);
					if (observer !== null) observer.disconnect();
					detach();
				};
			}, [focusId]);
			return [hostRef, hasDock];
		}
		/**
		 * The plugin settings page. Reachable from the sidebar entry and from the
		 * gear in the tab bar; also what you see while the workspace is switched off.
		 */
		//#region 视图条（会话视图切换）
		/**
		 * 读宿主注册的全部「会话视图」。
		 *
		 * 这是本功能**能自动兼容任意插件**的关键：数据源是宿主的
		 * `conversation.view` 注册表（kind:list / scope:session），
		 * 任何插件用 ctx.slots.inject 注册的视图都会出现在这里 ——
		 * 我们一个 id 都不写死，所以将来装了什么新插件都不用改本插件。
		 *
		 * label 在宿主里可能是函数（跟随 locale 变化），也可能直接是字符串。
		 * 取不到就退回 id，绝不因为别人插件给了怪值就崩掉整条。
		 */
		function readViewTabs() {
			const out = [];
			try {
				const slots = service("slots");
				const entries = slots?.entries?.("conversation.view") ?? [];
				for (const entry of entries) {
					const id = entry?.options?.id;
					if (typeof id !== "string" || id === "") continue;
					let label = entry.options.label;
					try {
						if (typeof label === "function") label = label();
					} catch {
						label = void 0;
					}
					out.push({
						id,
						label: typeof label === "string" && label !== "" ? label : id,
						order: typeof entry.options.order === "number" ? entry.options.order : 0
					});
				}
			} catch {
				/* 宿主没暴露 slots 时安静退回空表 */
			}
			return out;
		}

		/**
		 * 每个会话当前选中的视图 id。
		 *
		 * 存全局 Map 而不是 React state，是因为写它的是栏内的切换条、
		 * 读它的是宿主树里的 views 覆盖组件，两边不是同一棵子树。
		 * version 当 useSyncExternalStore 的快照，任何一次写入都让所有读者重渲染。
		 *
		 * ⚠️ 没写过 = 不覆盖：视图仍由宿主自己的 per-session store 决定，
		 * 这样用户没碰过视图条时行为与原生完全一致。
		 */
		const VIEW_STATE = {
			map: new Map(),
			version: 0,
			listeners: new Set(),
			getSnapshot() {
				return VIEW_STATE.version;
			},
			subscribe(listener) {
				VIEW_STATE.listeners.add(listener);
				return () => {
					VIEW_STATE.listeners.delete(listener);
				};
			},
			get(sessionId) {
				if (typeof sessionId !== "string") return void 0;
				return VIEW_STATE.map.get(sessionId);
			},
			set(sessionId, viewId) {
				if (typeof sessionId !== "string" || sessionId === "") return;
				if (VIEW_STATE.map.get(sessionId) === viewId) return;
				VIEW_STATE.map.set(sessionId, viewId);
				VIEW_STATE.version += 1;
				for (const listener of [...VIEW_STATE.listeners]) {
					try {
						listener();
					} catch {
						/* 坏订阅者不该拖垮切换 */
					}
				}
			}
		};

		/**
		 * 注册表订阅：别的插件后来注册/卸载视图时要能刷新。
		 *
		 * 宿主 `slots.subscribe` 存在就用它；不存在就 2s 轮询兜底
		 * （宿主那里 `list.subscribe` 实测不推送，所以两条路都留着）。
		 */
		function useViewTabs() {
			const [tabs, setTabs] = react.useState(() => readViewTabs());
			react.useEffect(() => {
				let alive = true;
				const refresh = () => {
					if (!alive) return;
					const next = readViewTabs();
					setTabs((prev) => {
						if (prev.length === next.length && prev.every((tab, index) => tab.id === next[index].id && tab.label === next[index].label && tab.order === next[index].order)) return prev;
						return next;
					});
				};
				let dispose = null;
				try {
					const slots = service("slots");
					if (typeof slots?.subscribe === "function") {
						dispose = slots.subscribe("conversation.view", refresh);
					}
				} catch {
					dispose = null;
				}
				const timer = setInterval(refresh, 2000);
				return () => {
					alive = false;
					clearInterval(timer);
					if (typeof dispose === "function") {
						try {
							dispose();
						} catch {}
					}
				};
			}, []);
			return tabs;
		}

		/** 把注册表 + 用户配置合成最终要显示的序列。 */
		function arrangeViewTabs(tabs, order, hidden) {
			const rank = new Map();
			order.forEach((id, index) => rank.set(id, index));
			const sorted = [...tabs].sort((a, b) => {
				const ra = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
				const rb = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
				if (ra !== rb) return ra - rb;
				if (a.order !== b.order) return a.order - b.order;
				return a.id < b.id ? -1 : 1;
			});
			const hiddenSet = new Set(hidden);
			return {
				shown: sorted.filter((tab) => !hiddenSet.has(tab.id)),
				folded: sorted.filter((tab) => hiddenSet.has(tab.id))
			};
		}

		/**
		 * 一个栏的视图内容。通过 `renderFactorySlot(CONTENT_FACTORY, …, {slots:{views: PaneViews}})`
		 * 替换宿主自己的 ConversationSessionView。
		 *
		 * 作用等于宿主那个默认实现（renderSlot("conversation.session")），
		 * 区别只在于：用户在本插件的视图条上选了某个视图时，把 `view` 显式传下去。
		 *
		 * ⚠️ wrapper 上的 key 是必须的：实测同一个 conversation.session 槽
		 * 只换 `view` 参数不会重新渲染宿主内容，必须让这层 DOM 重建。
		 */
		function PaneViews(props) {
			react.useSyncExternalStore(VIEW_STATE.subscribe, VIEW_STATE.getSnapshot, VIEW_STATE.getSnapshot);
			const desired = VIEW_STATE.get(props.sessionId);
			const args = desired === void 0 ? {} : { view: desired };
			/* ⚠️ 用 Fragment + key，不要多套一层 div。
			   多一层 DOM 会把宿主的 flex 链切断：宿主是
			     scrollBody（滚动容器）> viewArea（flex:1）+ composerSeat（sticky bottom:0）
			   中间插一层 wrapper 后，viewArea 的高度不再参与 scrollBody 的排版，
			   实测对话记录一长（1310px）输入框就被挤到内容中间、更长时直接跑出屏幕（y=-7427）。
			   Fragment 上的 key 同样能让子树在换视图时重建，但不产生任何 DOM 节点。 */
			return h(react.Fragment, { key: desired === void 0 ? "__host" : desired }, props.renderSlot("conversation.session", args));
		}

		//#region 宿主槽位渲染器（通用）
		/**
		 * 槽位注册表的版本号。
		 *
		 * 别的插件注册/卸载条目时要能重渲染，但宿主那条订阅通道实测不可靠
		 * （同 list.subscribe 一样不推送）。所以这里只做一件事：每 2s 比对一次
		 * 头部几个槽的「条目指纹」，变了就 bump。全局只跑一个定时器，不是每栏一个。
		 */
		const SLOT_REV = {
			rev: 0,
			listeners: new Set(),
			getSnapshot() {
				return SLOT_REV.rev;
			},
			subscribe(listener) {
				SLOT_REV.listeners.add(listener);
				return () => {
					SLOT_REV.listeners.delete(listener);
				};
			},
			bump() {
				SLOT_REV.rev += 1;
				for (const listener of [...SLOT_REV.listeners]) {
					try {
						listener();
					} catch {
						/* 坏订阅者不该拖垮整体 */
					}
				}
			}
		};

		/** 本插件关心的宿主槽位。加新容器时把槽名加进来，就会自动纳入指纹。 */
		const WATCHED_SLOTS = [
			"conversation.session.header.lineage",
			"conversation.session.header.actions",
			"conversation.session.header.utilities",
			"conversation.session.header.corner",
			"conversation.session.header.views.actions",
			"conversation.view"
		];

		/**
		 * 读一个槽位里的全部条目。
		 *
		 * ⚠️ 这是「兼容任意插件」的唯一正确姿势：**永远读注册表，不写死 id**。
		 * 以后任何插件（包括官方新插件）往这个槽位注册，都会自动出现在这里。
		 * 槽名是固定的少数几个（宿主 conversation.* 共 46 个），不是无限的。
		 */
		function readSlotEntries(slotName) {
			const out = [];
			try {
				const slots = service("slots");
				const list = slots?.entries?.(slotName) ?? [];
				for (const entry of Array.isArray(list) ? list : []) {
					if (typeof entry?.component !== "function") continue;
					const options = entry.options ?? {};
					out.push({
						key: String(options.id ?? `anon-${out.length}`),
						entry,
						order: typeof options.order === "number" ? options.order : 0
					});
				}
			} catch {
				/* 宿主没暴露 slots 时安静退回空表 */
			}
			out.sort((a, b) => (a.order !== b.order ? a.order - b.order : a.key < b.key ? -1 : 1));
			return out;
		}

		/** 空白标签没有会话 id 时，拿列表第一个当展示兜底（只读，不写任何状态）。 */
		function fallbackSessionId(sessions) {
			try {
				const snapshot = sessions?.list?.getSnapshot?.();
				const ids = snapshot?.ids ?? [];
				return typeof ids[0] === "string" ? ids[0] : null;
			} catch {
				return null;
			}
		}

		/** 一个槽位的条目 + 注册表变化时自动刷新。 */
		function useSlotEntries(slotName) {
			react.useSyncExternalStore(SLOT_REV.subscribe, SLOT_REV.getSnapshot, SLOT_REV.getSnapshot);
			return react.useMemo(() => readSlotEntries(slotName), [slotName, SLOT_REV.rev]);
		}

		/**
		 * 把宿主给的快照 store 包成一个「看起来像 hook」的 selector 函数。
		 *
		 * 宿主的组件签名里写的是 `useSessionLogDownload(selector)` 这种，
		 * 而 `entry.inject()` 的 `hooks` 里给的是 store 对象（有 getSnapshot/subscribe）。
		 * 这里把 store 转成组件期待的形状 —— 这是能复用宿主组件的关键一步。
		 */
		function makeSelectorHook(store) {
			return function useStoreSelector(selector) {
				const snapshot = react.useSyncExternalStore(
					(listener) => store.subscribe(listener),
					() => store.getSnapshot(),
					() => store.getSnapshot()
				);
				return typeof selector === "function" ? selector(snapshot) : snapshot;
			};
		}

		/**
		 * 会话级的 useSession：宿主是把它塞在 SessionProvider 里给组件的，
		 * 我们不在那个 scope 里，所以自己造一个 —— 数据源是宿主的会话列表快照。
		 *
		 * ⚠️ 只有列表行里那些字段（id/displayTitle/running/blank/cwd/title），
		 * 没有 `subagent` 这类深层字段。用到深字段的组件会拿到 undefined 而不崩，
		 * 由各自的分支决定画不画。
		 */
		function makeSessionRowHook(sessionId) {
			const sessions = SERVICES.sessions;
			return function useSessionRow(selector) {
				const snapshot = react.useSyncExternalStore(
					(listener) => sessions.list.subscribe(listener),
					() => sessions.list.getSnapshot(),
					() => sessions.list.getSnapshot()
				);
				/* ⚠️ 宿主给的是**单个会话**，不是整个列表快照。
				   早期版本把整个 snapshot 当 session 传下去，组件里 `session.subagent?.address`
				   于是拿到 undefined，再取 `.parentSessionId` 就崩 ——
				   表现是 lineage 两个组件全挂（报 reading 'parentSessionId'）。 */
				const row = snapshot !== void 0 && snapshot !== null && snapshot.byId !== void 0 ? snapshot.byId[sessionId] : void 0;
				return typeof selector === "function" ? selector(row) : row;
			};
		}

		/**
		 * conversation store（组件里的 useStore）。
		 *
		 * 宿主是 `resolveStore(entry.store, …)` 拿到它的；同一实例被多栏共享，所以缓存一次。
		 * 实测它带 `{draft, view, viewRequest}` —— 正好是 `useStore(s => s.view)` 要的东西。
		 * 之前报 `store handle is not registered` 是参数给错了（该用 entry.store 本身）。
		 */
		/** 把某个条目的 store 解析成 {getSnapshot, subscribe} 句柄；解析不了返回 null。 */
		function slotsResolveStore(entry, sessionId) {
			try {
				const slots = service("slots");
				if (typeof slots?.resolveStore !== "function") return null;
				const handle = slots.resolveStore(entry.store, { sessionId });
				if (handle === void 0 || handle === null) return null;
				if (typeof handle.getSnapshot !== "function" || typeof handle.subscribe !== "function") return null;
				return handle;
			} catch {
				return null;
			}
		}

		let CONV_STORE = null;
		function conversationStoreHandle() {
			if (CONV_STORE !== null) return CONV_STORE;
			try {
				const slots = service("slots");
				const entry = (slots.entries?.("conversation.session") ?? [])[0];
				if (entry === void 0 || entry.store === void 0) return null;
				const resolved = slots.resolveStore(entry.store, {});
				if (resolved !== void 0 && resolved !== null && typeof resolved.getSnapshot === "function") CONV_STORE = resolved;
			} catch {
				CONV_STORE = null;
			}
			return CONV_STORE;
		}

		/** 宿主本地的翻译函数。字典没绑上时会返回 key 本身，可接受（不崩）。 */
		function hostTranslate(name) {
			try {
				const locale = SERVICES.ctx?.get?.("locale");
				if (locale !== void 0 && locale !== null && typeof locale.bind === "function") return locale.bind(name ?? "conversation");
			} catch {
				/* 拿不到就退回原样输出 */
			}
			return (key) => key;
		}

		/**
		 * 渲染槽位里的**一个**条目。
		 *
		 * 每个条目自己是一层错误边界：某个第三方组件的 props 我们凑不齐时它自己挂，
		 * 不能把整个栏带走（宿主自己的 header 崩了会整块白屏）。
		 */
		function SlotEntry(props) {
			const { item, sessionId, extra } = props;
			const built = react.useMemo(() => {
				let injected = null;
				try {
					if (typeof item.entry.inject === "function") {
						injected = item.entry.inject(sessionId, { setView: () => {} });
					}
				} catch {
					injected = null;
				}
				const propsForComponent = { ...HOST_SLOT_PROPS };
				delete propsForComponent.SessionProvider;
				delete propsForComponent.renderFactorySlot;
				propsForComponent.sessionId = sessionId;
				propsForComponent.t = hostTranslate(item.entry.locale ?? "conversation");
				if (injected !== null && typeof injected === "object") {
					for (const key of Object.keys(injected)) {
						if (key === "hooks") continue;
						propsForComponent[key] = injected[key];
					}
					const hooks = injected.hooks ?? {};
					for (const key of Object.keys(hooks)) {
						const store = hooks[key];
						if (store === null || store === void 0) continue;
						if (typeof store.getSnapshot !== "function" || typeof store.subscribe !== "function") continue;
						/* hooks.sessionLogDownload → 组件里的 useSessionLogDownload */
						const name = "use" + key.charAt(0).toUpperCase() + key.slice(1);
						propsForComponent[name] = makeSelectorHook(store);
					}
				}
				/* 宿主塞给组件的这几个，我们不在它的 scope 里拿不到，自己造等价物。
				   目的不是行为完全一致，而是让组件能渲染出来、不抛 TypeError。 */
				if (typeof propsForComponent.useSession !== "function") propsForComponent.useSession = makeSessionRowHook(sessionId);
				/* useStore 必须是**这个条目自己的 store**，不是会话的那个。
				   实测 corner 的条目 store 快照是 `{bySession}`（右侧栏展开状态），
				   而 conversation store 快照是 `{draft, view, viewRequest}` —— 给错了就
				   报 `useStore is not a function` 或读到 undefined。 */
				if (typeof propsForComponent.useStore !== "function") {
					let store = null;
					try {
						if (item.entry.store !== void 0) store = slotsResolveStore(item.entry, sessionId);
					} catch {
						store = null;
					}
					if (store === null) store = conversationStoreHandle();
					if (store !== null) {
						propsForComponent.useStore = makeSelectorHook(store);
						/* ⚠️ store 的 actions 也要一起给：组件点了按钮是靠 actions.xxx() 真正改状态的。
							例如右侧栏的 ExpandButton 签名是 `{sessionId, useStore, actions, t, useShortcuts}`，
							没有 actions 时按钮画得出来但点了什么都不发生（用户实测「点了没反应」就是这个）。
							resolveStore 的返回里就带 actions，之前只取了 getSnapshot/subscribe 漏掉了它。 */
						if (propsForComponent.actions === void 0 && store.actions !== void 0) propsForComponent.actions = store.actions;
					}
				}
				if (typeof propsForComponent.useAccess !== "function" && typeof propsForComponent.useRemoteAccess === "function") {
					propsForComponent.useAccess = propsForComponent.useRemoteAccess;
				}
				/* ⚠️ isCurrent 必须强制为 true。
				   宿主给的 isCurrent 判断的是「这个会话是不是宿主主视图的那一个」，
				   我们栏里的会话永远不是 → 它返回 false。
				   而不少按钮的 onClick 第一行就是 `if (!isCurrent()) return;`
				   （实测 context-diagnostics 正是如此），于是按钮画得出来、点了完全没反应。
				   从用户角度看，这一栏就是在看这个会话，判定它「当前」是合理的。 */
				/* 右侧栏的 ExpandButton 只调 actions.setExpanded（改它自己的 store），
				   但真正撑开右栏列的是 shell 的 layout.panels.openRightbar(track, fullscreen)。
				   ⚠️ track 必须传，传 undefined 时 rightbarTrack 为 falsy，列宽直接被算成 0
				   —— 实测「按钮点了没反应」就是这个：状态改了，栏还是 0 宽。
				   这里把 actions 包一层：调 setExpanded 的同时打开右栏。 */
				if (propsForComponent.actions !== void 0 && typeof propsForComponent.actions === "object") {
					const inner = propsForComponent.actions;
					if (typeof inner.setExpanded === "function") {
						propsForComponent.actions = {
							...inner,
							setExpanded: (id, value) => {
								try {
									inner.setExpanded(id, value);
								} catch (error) {
									console.warn("[split-view] setExpanded 失败:", error);
								}
								try {
									const panels = SERVICES.layout?.panels;
									if (panels === void 0 || panels === null) return;
									if (value === true) panels.openRightbar?.(true, false);
									else panels.closeRightbar?.();
								} catch (error) {
									console.warn("[split-view] 右侧栏开合失败:", error);
								}
							}
						};
					}
				}
				if (typeof propsForComponent.isCurrent === "function") {
					const originalIsCurrent = propsForComponent.isCurrent;
					propsForComponent.isCurrent = () => {
						try {
							if (originalIsCurrent() === true) return true;
						} catch {
							/* 宿主自己判定失败也放行 */
						}
						return true;
					};
				}
				if (extra !== void 0) Object.assign(propsForComponent, extra);
				return propsForComponent;
			}, [item, sessionId, extra]);

			/* 外面包一层带 id 的容器：出错时能看出是谁，CSS 也能按条目单独调。
			   注意必须是 inline-flex 且不改变高度，否则会把 header 拉伸。 */
			/* 上下文诊断这类条目：点下去它会去开右栏 tab，但它只改
			   sidebarRight store 的 expanded，**不动 layout 的列宽**。
			   实测结果就是「诊断跑完了、内容也生成了，但右栏列宽 0，
			   面板挤在 0 宽轨道里」→ 用户看到空白。
			   这里在捕获阶段先替它把列宽打开，它后续聚焦 tab 才有地方显示。
			   —— 只影响这一个条目，不引入全局同步（全局同步会和宿主的
			   syncPresentation 互相覆盖，试过两次都不稳）。 */
			const needsRightbar = item.entry.options !== void 0 && item.entry.options !== null && item.entry.options.id === "dsh-better-sidebar:context-diagnostics";
			const preOpen = needsRightbar
				? {
						onClickCapture: () => {
							/* 两件事都要做，缺任何一件诊断都会超时：
							 *
							 * ① 把宿主「当前会话」切到本栏会话。
							 *    上下文诊断内部第一行就是
							 *        if (right.mounted.getSnapshot() !== request.target.sessionId) return;
							 *    mounted 来自宿主的「在屏会话」，而多栏下它只认
							 *    uiSession.adapter.current —— 和我们这一栏的会话没关系。
							 *    实测某次启动：mounted=2026f703，两栏分别是 87b7d793 /
							 *    ad6509d2，**三个都不是同一个**，所以不管点哪栏都超时。
							 *    replaceMain 是唯一能改它的公开路径（实测 mounted 立刻跟着变）。
							 *
							 * ② 把右栏列宽打开。诊断只改 store 的 expanded，不动
							 *    layout 的 track；列宽 0 时面板挤在 0 宽轨道里 → 空白。
							 */
							try {
								const workspace = SERVICES.ctx?.get?.("uiWorkspace");
								if (workspace !== void 0 && workspace !== null && typeof workspace.replaceMain === "function" && typeof sessionId === "string" && sessionId !== "") {
									const ac = new AbortController();
									workspace.replaceMain(sessionId, ac.signal, "keep");
								}
							} catch (error) {
								console.warn("[split-view] 诊断前切会话失败:", error);
							}
							try {
								SERVICES.layout?.panels?.openRightbar?.(true, false);
							} catch (error) {
								console.warn("[split-view] 诊断前开右栏失败:", error);
							}
						}
					}
				: null;
			return h(
				SlotBoundary,
				{ name: item.key },
				h("div", { className: "dsv-slotitem", "data-slot-entry": item.key, ...(preOpen ?? {}) }, h(item.entry.component, built))
			);
		}

		/** 单个第三方组件失败时的屏障：吞掉错误，只让这一格消失。 */
		class SlotBoundary extends react.Component {
			constructor(props) {
				super(props);
				this.state = { failed: false };
			}
			static getDerivedStateFromError() {
				return { failed: true };
			}
			componentDidCatch(error) {
				if (typeof console !== "undefined") console.warn(`[split-view] 槽位组件 ${this.props.name} 渲染失败:`, error);
			}
			render() {
				return this.state.failed === true ? null : this.props.children;
			}
		}

		/** 渲染一个槽位里的全部条目。 */
		function SlotList(props) {
			const { slotName, sessionId, className, extra, place } = props;
			const items = useSlotEntries(slotName);
			if (items.length === 0) return null;
			return h(
				"div",
				{ className: className ?? "dsv-slotrow", "data-slot-place": place ?? "" },
				...items.map((item) => h(SlotEntry, { key: item.key, item, sessionId, extra }))
			);
		}
		//#endregion

		/**
		 * 宿主会话头的生活区：左侧标题/面包屑，右侧那排按钮。
		 *
		 * 数据全部来自宿主槽位注册表 —— 装上任何新插件、官方发布新按钮，
		 * 只要它注册进这 5 个槽位之一，这里就自动出现，本插件不用改代码。
		 *
		 * 每格都有自己的错误边界（见 SlotEntry），一个第三方组件挂了只消失一格。
		 */
		/**
		 * 有些宿主的 header 组件（如 dsh-better-sidebar 的「展开底部面板」）
		 * 不通过 inject/store 暴露状态，而是把自己的 store 直接闭包进组件：
		 * `() => jsx(BottomDockToggle, { store })`。
		 * 那个 store 默认没有绑定会话（getSnapshot().sessionId === undefined），
		 * 于是 `store.reduce(toggleBottomPanel)` 读到 undefined 状态 → 点按钮毫无反应。
		 * 宿主原生是绑定过的，所以原生能点。
		 *
		 * 这里在渲染后从 DOM 反查 fiber、取出组件 props 上的 store，补 setSession。
		 * 只在 sessionId 不匹配时调用，且吞掉所有异常（拿不到就算了，不影响别的条目）。
		 */
		function adoptClosureStores(root, sessionId) {
			if (root === null || root === void 0 || sessionId === null || sessionId === void 0) return;
			const nodes = root.querySelectorAll("button, [data-dsh-bottom-toggle], [data-slot-entry]");
			const seen = new Set();
			for (const node of nodes) {
				const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
				if (key === void 0) continue;
				let fiber = node[key];
				for (let depth = 0; depth < 14 && fiber !== null && fiber !== void 0; depth += 1) {
					const store = fiber.memoizedProps?.store;
					if (store !== null && store !== void 0 && typeof store.setSession === "function" && typeof store.getSnapshot === "function") {
						if (seen.has(store) === false) {
							seen.add(store);
							try {
								if (store.getSnapshot().sessionId !== sessionId) store.setSession(sessionId);
							} catch (error) {
								console.warn("[split-view] 绑定闭包 store 失败:", error);
							}
						}
						break;
					}
					fiber = fiber.return;
				}
			}
		}

		/**
		 * 右侧边栏开关（自绘，替代宿主的 ExpandButton）。
		 *
		 * 为什么不用宿主的：它的源码是
		 *     const expanded = useStore(s => s.bySession[sid]?.layout.expanded ?? false);
		 *     if (expanded && !isMobileDevice()) return null;
		 * 它读的 per-session store 与 sidebarRight 控制器写的**不是同一实例**
		 * （实测那份 expanded 会长期停在 true 不回落），于是「点一下展开、
		 * 收起之后按钮就永久消失」，再也点不到。
		 * 换 store、合成快照、状态拉正都试过，都会被宿主的卸载逻辑绕回去。
		 *
		 * 所以自己画：状态直接问 controller.isExpanded()（唯一真源），
		 * 点击直接调 controller.toggleExpanded()（实测能真正收起/展开列）。
		 */
		/**
		 * 右侧边栏开关（自绘）。
		 *
		 * 宿主原生的 ExpandButton 不能用：它读的 per-session store 与
		 * sidebarRight 控制器写的不是同一实例，展开后 expanded 卡在 true
		 * 不回落，于是「收起之后按钮永久消失」。
		 *
		 * controller.toggleExpanded() 也不能用：它在多栏下依赖「on-screen
		 * 会话」做焦点转移，实测两个 pane 时点了状态变了、列宽却不动。
		 *
		 * 所以这里只做一件事 —— 直接驱动 layout 的右栏轨道：
		 *   · 关：layout.panels.closeRightbar()      → 右列 minmax(0px, 0px)
		 *   · 开：layout.panels.openRightbar(true,false) → 右列 minmax(0px, Npx)
		 * 方向按**实际列宽**判断，不信任何 store。状态也从实际列宽读。
		 */
		/**
		 * 右栏「该开却没开」的兜底（**单向，只补开**）。
		 *
		 * 宿主右侧栏用两套状态：
		 *   · sidebarRight store 的 layout.expanded —— 上下文诊断、收起按钮读它
		 *   · layout.panelInfo.layoutInfo.rightbarTrack —— 真正决定列宽的
		 * 宿主自己的 syncPresentation 在 store 变化时调
		 * `layout.openRightbar(track, fullscreen)`，而那个 track 来自 store 的偏好，
		 * 某些时序下是 false → 等价于 closeRightbar，列宽被压回 0。
		 * 实测：诊断跑完、内容 25708 字符都在，但 colW=0，面板挤在 0 宽轨道里 → 空白。
		 *
		 * 这里只处理一种情况：**store 说已展开，但列宽是 0** → 补一次 openRightbar。
		 * 绝不处理反方向（store 说收起时不去关），所以不会和宿主的收起逻辑打架，
		 * 也不会把正在进行的过渡动画拉回去。
		 */
		function startRightbarKeepOpen() {
			setInterval(() => {
				try {
					const right = SERVICES.ctx?.get?.("sidebarRight");
					const panels = SERVICES.layout?.panels;
					if (right === void 0 || right === null || panels === void 0 || panels === null) return;
					/* 插件关掉后不再干预宿主的右栏 —— 它自己会管开合。 */
					if (prefs.state.enabled !== true) return;
					if (typeof right.isExpanded !== "function" || right.isExpanded() !== true) return;
					const col = document.querySelector(".mP3x-q_rightbarCol");
					if (col === null) return;
					if (col.getBoundingClientRect().width > 1) return;
					panels.openRightbar?.(true, false);
				} catch {
					/* 忽略 */
				}
			}, 900);
		}

		function RightbarToggle() {
			const [open, setOpen] = react.useState(false);
			const measure = react.useCallback(() => {
				let next = false;
				try {
					const col = document.querySelector(".mP3x-q_rightbarCol");
					next = col !== null && col.getBoundingClientRect().width > 1;
				} catch {
					next = false;
				}
				setOpen((prev) => (prev === next ? prev : next));
				return next;
			}, []);
			react.useEffect(() => {
				measure();
				window.addEventListener("resize", measure);
				/* 宿主的展开/收起有过渡，点击后我们自己再补测两次，避免状态滞后。 */
				const t1 = window.setTimeout(measure, 600);
				const t2 = window.setTimeout(measure, 1600);
				return () => {
					window.removeEventListener("resize", measure);
					window.clearTimeout(t1);
					window.clearTimeout(t2);
				};
			}, [measure]);
			const label = open ? "收起右侧边栏" : "打开右侧边栏";
			return h(
				"button",
				{
					type: "button",
					className: "dsv-btn",
					title: label,
					"aria-label": label,
					"aria-pressed": open ? "true" : "false",
					"data-dsv-rightbar-toggle": "1",
					onClick: () => {
						const panels = SERVICES.layout?.panels;
						if (panels === void 0 || panels === null) return;
						const isOpen = measure();
						const next = !isOpen;
						/* store 和 layout 两边都要写。
						 * 只写 layout：keep-open 兜底会看到「store 说开、列宽却关了」，
						 *            于是在下一拍又把栏顶开 —— 按钮点了没反应。
						 * 只写 store：宿主的 syncPresentation 传的 track 可能为 false，
						 *            列宽仍被压成 0。 */
						try {
							const right = SERVICES.ctx?.get?.("sidebarRight");
							if (right !== null && right !== void 0 && typeof right.isExpanded === "function" && typeof right.toggleExpanded === "function") {
								if ((right.isExpanded() === true) !== next) right.toggleExpanded();
							}
						} catch (error) {
							console.warn("[split-view] 右栏 store 切换失败:", error);
						}
						try {
							if (next) panels.openRightbar?.(true, false);
							else panels.closeRightbar?.();
						} catch (error) {
							console.warn("[split-view] 右栏列宽切换失败:", error);
						}
						setOpen(next);
						window.setTimeout(measure, 500);
						window.setTimeout(measure, 1400);
					}
				},
				h(
					"svg",
					{
						/* 直接用宿主自己的图标 sprite，跟官方「打开右侧边栏」按钮是同一个 symbol
						   （官方 ExpandButton 内部就是 IconPanelLeftOutlineRegular →
						   <use href="#dsw-icon-panel-left-outline-regular">）。
						   抄 path 会随宿主版本漂移，引用 symbol 不会。 */
						className: "dsv-icon",
						"aria-hidden": "true",
						focusable: "false"
					},
					h("use", { href: "#dsw-icon-panel-left-outline-regular" })
				)
				);
		}

		/**
		 * 「更多」：把被 .dsv-hostbar-right 裁掉的会话头按钮收进一个下拉菜单。
		 *
		 * 用户口径 2026-11-08（方案 B）：窄栏时次要按钮不要直接消失，要能点。
		 *   · 不做重渲染 —— 菜单项只列出被裁那些按钮的 aria-label，
		 *     点击时直接对**原来那颗按钮**派发 click()。
		 *     这样宿主按钮自己的事件、弹层、快捷键全都照旧，我们只是帮它
		 *     「再露出一个入口」，宿主升级也不会崩（不碰它的渲染）。
		 *   · 没有任何按钮被裁时，这个按钮整个不渲染（栏宽足够时界面保持原样）。
		 */
		function CollapsedActions(props) {
			const { rightRef, availPx, onNeed } = props;
			const [open, setOpen] = react.useState(false);
			const [pos, setPos] = react.useState(null);
			const [items, setItems] = react.useState([]);
			/* 上报「整组按钮全部露出来需要多宽」给外层（Pane），用于「一行 / 两行」判定。
			   用 ref 拿回调：collect 是 useCallback，把 onNeed 放进依赖会让它每次重建。 */
			const needRef = react.useRef(onNeed);
			needRef.current = onNeed;

			const collect = react.useCallback(() => {
				const right = rightRef.current;
				if (right === null) return [];
				const entries = Array.from(right.querySelectorAll("[data-slot-entry]"));
				if (entries.length === 0) return [];
				/* ⚠️ 每次都先全部恢复再重算：上一版只在「当前可见的」里判断，
				   已经藏掉的按钮 rect 宽为 0 被跳过 → 越藏越多 → 最后全藏光，
				   ⋯ 因为 items 为空也不渲染，功能彻底丢失。 */
				for (const entry of entries) entry.style.display = "";
				/* display 刚恢复，这一轮读到的就是「全显真实宽度」——
				   立刻上报给 Pane 做一行/两行判定（这里与 avail 无关，
				   所以不会和下面的折叠结果形成循环）。 */
				let fullNeed = 0;
				for (const entry of entries) {
					const r = entry.getBoundingClientRect();
					if (r.width < 1) continue;
					const button = entry.querySelector("button") ?? entry;
					const label = (button.getAttribute("aria-label") || button.title || "").trim();
					/* 宿主的「更多操作」永远被收进我们这颗「⋯」（否则界面上会有两个"更多"），
					   所以它不计入「一行需要多宽」—— 否则每栏都白算一颗按钮的宽度，
					   明明放得下也会被判成两行。 */
					if (label.indexOf("更多操作") >= 0) continue;
					fullNeed += r.width + 6;
				}
				if (fullNeed > 0 && typeof needRef.current === "function") needRef.current(Math.round(fullNeed));
				const box = right.getBoundingClientRect();
				/* 可用宽度由 Pane 算好传进来（它知道本栏宽、标题宽、切换条要不要占位）。
				   没传就退回按钮组自己的宽度。 */
				const avail = typeof availPx === "number" && availPx > 0 ? availPx : box.width;
				if (!(avail > 0)) return [];
				const clipped = [];
				let used = 0;
				for (const entry of entries) {
					const rect = entry.getBoundingClientRect();
					if (rect.width < 1) continue;
					const button = entry.querySelector("button") ?? entry;
					const label = (button.getAttribute("aria-label") || button.title || "").trim();
					/* 用户口径：「右边那一组最多有一个菜单」—— 宿主自己的「更多操作」
					   必须永远收进我们这个菜单，否则界面上会同时出现两个"更多"。
					   （实测就是两个「更多操作」并排，用户一眼就看出来了。） */
					const isHostMore = label === "更多操作" || label.indexOf("更多操作") >= 0;
					const need = rect.width + 6;
					if (isHostMore === true || used + need > avail + 1) {
						entry.style.display = "none";
						if (label !== "") clipped.push({ label, clipped: true, button });
					} else {
						used += need;
					}
				}
				return clipped;
			}, [rightRef, availPx]);

			react.useEffect(() => {
				const sync = () => {
					const next = collect().filter((item) => item.clipped === true);
					setItems((prev) => {
						if (prev.length === next.length && prev.every((p, i) => p.label === next[i].label)) return prev;
						return next;
					});
				};
				sync();
				const timer = window.setInterval(sync, 800);
				window.addEventListener("resize", sync);
				return () => {
					window.clearInterval(timer);
					window.removeEventListener("resize", sync);
					const right = rightRef.current;
					if (right !== null) for (const entry of right.querySelectorAll("[data-slot-entry]")) entry.style.display = "";
				};
			}, [collect]);

			if (items.length === 0) return null;

			return h(
				"div",
				{ className: "dsv-slotrow", "data-dsv-collapsed": "1" },
				h(
					"button",
					{
						type: "button",
						className: "dsv-btn",
						title: "更多",
						"aria-label": "更多",
						"aria-haspopup": "menu",
						"aria-expanded": open ? "true" : "false",
						onClick: (event) => {
							const r = event.currentTarget.getBoundingClientRect();
							setPos({ left: Math.round(Math.max(8, r.right - 200)), top: Math.round(r.bottom + 4) });
							setOpen((value) => !value);
						}
					},
					"⋯"
				),
				open === true
					? h(
							"div",
							{
								className: "dsv-vmenu",
								role: "menu",
								style:
									pos === null
										? void 0
										: { position: "fixed", left: `${pos.left}px`, top: `${pos.top}px`, zIndex: 90 }
							},
							h("div", { className: "dsv-vmenu-head" }, "更多"),
							...items.map((item) =>
								h(
									"button",
									{
										key: item.label,
										type: "button",
										role: "menuitem",
										className: "dsv-vmenu-item",
										onClick: () => {
											setOpen(false);
											try {
												item.button.click();
											} catch (error) {
												console.warn("[split-view] 转发点击失败:", error);
											}
										}
									},
									h("span", { className: "dsv-vmenu-check", "aria-hidden": "true" }, ""),
									h("span", { className: "dsv-vmenu-label" }, item.label)
								)
							)
						)
					: null
			);
		}

		function HostBar(props) {
			const { sessionId, showChrome, sessions, SessionProvider, viewBar, rightAvail, onRightNeed } = props;
			const hostBarRef = react.useRef(null);
			const rightRef = react.useRef(null);
			react.useEffect(() => {
				if (sessionId === null || sessionId === void 0) return;
				let cancelled = false;
				const run = () => { if (cancelled === false) adoptClosureStores(hostBarRef.current, sessionId); };
				run();
				const timer = window.setTimeout(run, 400);
				return () => { cancelled = true; window.clearTimeout(timer); };
			}, [sessionId]);
			/* ⚠️ useSessionReference 内部有 2 个 hook（useReducer + useEffect），必须**无条件调用**。
			   它原来放在 `showChrome !== true || sessionId === null` 的早退之后：
			   空标签（sessionId=null）先渲染一次（不调 hook），等会话就绪后再调 → hook 数量变化
			   → React #310「Rendered more hooks than during the previous render」，
			   整个工作区被错误边界吞掉、退回原生单栏（2026-11-08 实测）。
			   现在先无条件调用（不可渲染时传 null，内部 effect 自己会跳过），再早退。 */
			const renderable = showChrome === true && sessionId !== null && sessionId !== void 0;
			const { reference } = useSessionReference(sessions, renderable === true ? sessionId : null);
			if (renderable !== true) return null;
			const sessionTitle = String(sessions?.list?.getSnapshot?.()?.byId?.[sessionId]?.displayTitle ?? "").trim();
			const inner = h(
				"div",
				{ className: "dsv-hostbar", ref: hostBarRef },
				/* lineage（子智能体面包屑）：宿主父组件会传 lineageSessionId/displayTitle，
				   我们同样能从会话列表算出来（本级 = 自己）。层级信息只有宿主内部才有，
				   所以子智能体那一路仍会自己判定不画；普通会话显示自己的名字。 */
				h(
					"div",
					{ className: "dsv-hostbar-left" },
					h(SlotList, {
						slotName: "conversation.session.header.lineage",
						sessionId,
						className: "dsv-slotrow",
						place: "lineage",
						extra: {
							lineageSessionId: sessionId,
							displayTitle: sessionTitle,
							openTitle: void 0
						}
					}),
					/* 这里**不再画标题**：标签条上已经有会话名了（如「友好问候」），
					   再画一遍就是重复 —— 用户直接问「上面那个标签页上显示的是什么？」。
					   宿主 lineage 槽渲不出内容时这块就留空，min-width:0 保证它不吃宽度。 */
				),
				/* 视图切换条插在「标题区」和「按钮区」之间：一行放得下就同行，
				   放不下时 .dsv-hostbar 会换行把它推到第二行（用户口径 2026-11-08）。 */
				viewBar !== void 0 && viewBar !== null ? viewBar : null,
				h(
					"div",
					{ className: "dsv-hostbar-right", ref: rightRef },
					h(SlotList, { slotName: "conversation.session.header.actions", sessionId, className: "dsv-slotrow", place: "actions" }),
					h(SlotList, { slotName: "conversation.session.header.utilities", sessionId, className: "dsv-slotrow", place: "utilities" })
				),
				/* corner 槽 = 「展开/收起右侧边栏」的座位（宿主文档原话：这个入口就是
				   conversation header 里的 ExpandButton 那一个位置）。
				   只放我们自绘的开关：宿主的 ExpandButton 展开后会把自己卸载，
				   收起后按钮永久消失；而且再并排渲染一次就会出现两个同样的按钮
				   （用户实测「怎么有两个按钮」）。所以这里不渲染宿主条目。
				   ⚠️ 必须放在 .dsv-hostbar-right **外面**：按钮组会压缩、会裁自己的内容，
				   放里面时这颗会被一起裁掉或和相邻按钮重叠（用户实测三个按钮叠在一起）。 */
				h(CollapsedActions, { key: "dsv-collapsed-actions", rightRef, availPx: rightAvail, onNeed: onRightNeed }),
				h("div", { className: "dsv-slotrow", "data-slot-place": "corner" }, h(RightbarToggle, { key: "dsv-rightbar-toggle" }))
			);
			/* ⚠️ 必须包 SessionProvider：不少 header 组件（尤其是第三方的）
			   在点击时读 React Context 拿「当前 session」，不在 provider 里就静默失效
			   ——按钮画得出来、点了什么都不发生。这一层不能省。 */
			if (typeof SessionProvider === "function" && reference !== void 0) {
				return h(SessionProvider, { session: reference }, inner);
			}
			return inner;
		}

		/**
		 * 视图切换条。
		 *
		 * 数据全来自宿主注册表，所以：装任何新插件 → 它的视图自动出现在这里，
		 * 本插件不用改一行。显示哪些 / 什么顺序 / 放顶部还是底部，都由设置决定。
		 *
		 * 窄栏策略：先按容器实际宽度算能放几个，放不下的进「…」；
		 * 用户手动关掉的也进「…」。所以「…」里既有被关的也有被挤的。
		 */
		function ViewBar(props) {
			const { sessionId, placement, prefsState, onNeed } = props;
			const tabs = useViewTabs();
			/* 上报「全部标签完整显示需要多宽」给外层（Pane），用于「一行 / 两行」判定。
			   必须在折叠判定之外算：一行判据问的是"不折叠能不能站下"，
			   若拿当前可见（已折叠）的宽度去判，就会「因为已经折叠了，所以算得下」，
			   永远不换行。用 ref 拿回调，避免 effect 依赖变化导致测量循环。 */
			const needRef = react.useRef(onNeed);
			needRef.current = onNeed;
			react.useSyncExternalStore(VIEW_STATE.subscribe, VIEW_STATE.getSnapshot, VIEW_STATE.getSnapshot);
			const { shown, folded } = react.useMemo(
				() => arrangeViewTabs(tabs, prefsState.viewBarOrder, prefsState.viewBarHidden),
				[tabs, prefsState.viewBarOrder, prefsState.viewBarHidden]
			);
			const current = VIEW_STATE.get(sessionId);
			const activeId = current === void 0 ? (shown.find((tab) => tab.id === "chat")?.id ?? shown[0]?.id) : current;

			const barRef = react.useRef(null);
			const rowRef = react.useRef(null);
			const measureRef = react.useRef(null);
			const [fitCount, setFitCount] = react.useState(shown.length);
			const [menuOpen, setMenuOpen] = react.useState(false);
			/* 菜单用 position:fixed 定位（坐标在这里算）：会话头有 overflow:hidden，
			   绝对定位的下拉会被裁掉 —— 用户实测「⋯ 点了没任何反应」，其实菜单弹出来了，
			   只是被裁在容器外看不见。fixed 不受任何祖先 overflow 影响。 */
			const [menuPos, setMenuPos] = react.useState(null);
			const [measured, setMeasured] = react.useState(false);

			/* 决定露出几个：用 canvas 量文字宽度，不依赖 DOM 布局。
			   
			   为什么不用「隐藏测量行 + getBoundingClientRect」：
			   实测窄栏时那一行被父级 overflow:hidden 裁到不可见后，
			   Chromium 会返回 0 宽 → 每个标签都算成 0 → 拟合结果恒为「全放得下」，
			   表现就是 400px 栏还正常、300px 栏又变回显示 5 个（查了两轮才定位到）。
			   canvas.measureText 只跟字体和字符串有关，和布局无关，缩到多窄都准。
			   
			   触发源用「ResizeObserver + 400ms 轮询」双保险：只留一种都失败过 ——
			   rAF 在窗口不可见（document.hidden）时不触发；观察内容会变的行会形成
			   布局循环被浏览器丢弃通知。观察宽度稳定的 .dsv-viewbar，再加轮询兜底。 */
			react.useLayoutEffect(() => {
				const bar = barRef.current;
				const row = rowRef.current;
				if (bar === null || row === null) return;
				let timer = 0;
				let lastWidth = -1;
				let lastKey = "";
				const measureLabel = (label, font) => {
					try {
						const canvas = document.createElement("canvas");
						const ctx = canvas.getContext("2d");
						if (ctx === null) return 0;
						ctx.font = font;
						return ctx.measureText(label).width;
					} catch {
						return 0;
					}
				};
				const compute = (force) => {
					const width = row.clientWidth;
					if (!(width > 0)) return;
					const key = shown.map((tab) => tab.id + ":" + tab.label).join("|");
					if (force !== true && width === lastWidth && key === lastKey) return;
					lastWidth = width;
					lastKey = key;
					if (shown.length === 0) {
						setFitCount(0);
						setMeasured(true);
						return;
					}
					/* 用实际渲染出来的标签取字体；一个都没有时退回样式表里的那套。 */
					const probe = row.querySelector(".dsv-vtab[data-view-id]");
					let font = "500 13px 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif";
					if (probe !== null) {
						const cs = getComputedStyle(probe);
						font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
					}
					const widths = shown.map((tab) => Math.ceil(measureLabel(tab.label, font)));
					const gap = 14;
					const fitIn = (budget) => {
						let used = 0;
						let count = 0;
						for (let index = 0; index < widths.length; index += 1) {
							const next = used + (index === 0 ? 0 : gap) + widths[index];
							if (next > budget) break;
							used = next;
							count += 1;
						}
						return count;
					};
					let count = fitIn(width);
					if (count < widths.length) {
						/* 要给「…」让位：从可用宽里扣掉它的宽 + 两侧间隔后重算。
						   「…」前面有两份间隔：.dsv-viewtabs 的 gap(14) + .dsv-vmore 自己的
						   margin-left(14) —— 只扣 26+14 会少算 14px，临界宽度下最后那个标签
						   被硬裁（实测 130px 栏 scrollWidth 110 > clientWidth 96）。 */
						count = fitIn(width - (26 + gap * 2));
					}
					setFitCount(Math.max(0, count));
					setMeasured(true);
					/* 上报「全部标签完整显示」的需求宽（不含「…」）：外层据此判一行还是两行。 */
					if (typeof needRef.current === "function") {
						let total = 0;
						for (let index = 0; index < widths.length; index += 1) {
							total += widths[index] + (index === 0 ? 0 : gap);
						}
						needRef.current(total);
					}
				};
				const schedule = () => {
					if (timer !== 0) return;
					timer = setTimeout(() => {
						timer = 0;
						compute(false);
					}, 0);
				};
				compute(true);
				const poll = setInterval(() => compute(false), 400);
				let observer = null;
				if (typeof ResizeObserver !== "undefined") {
					observer = new ResizeObserver(schedule);
					observer.observe(bar);
				}
				return () => {
					clearInterval(poll);
					if (timer !== 0) clearTimeout(timer);
					if (observer !== null) observer.disconnect();
				};
			}, [shown, prefsState.viewBarPlacement]);

			/* 焦点变化时关掉菜单，免得它挂在旧的栏上。 */
			react.useEffect(() => {
				setMenuOpen(false);
			}, [sessionId]);

			const visible = measured ? shown.slice(0, Math.max(0, fitCount)) : shown;
			const overflow = [...shown.slice(visible.length), ...folded];
			const activeInOverflow = overflow.some((tab) => tab.id === activeId) && !visible.some((tab) => tab.id === activeId);

			const pick = (id) => {
				VIEW_STATE.set(sessionId, id);
				setMenuOpen(false);
			};

			return h(
				"div",
				{
					className: "dsv-viewbar",
					ref: barRef,
					"data-placement": placement,
				},
				h(
					"div",
					{ className: "dsv-viewtabs", role: "tablist", ref: rowRef },
					visible.length === 0 && overflow.length === 0 ? h("span", { className: "dsv-viewempty" }, "宿主未注册任何会话视图") : null,
					...visible.map((tab) =>
						h(
							"button",
							{
								key: tab.id,
								type: "button",
								role: "tab",
								className: "dsv-vtab",
								"data-active": tab.id === activeId ? "1" : "0",
								"data-view-id": tab.id,
								title: tab.label,
								"aria-selected": tab.id === activeId ? "true" : "false",
								onClick: () => pick(tab.id)
							},
							h("span", { className: "dsv-vtab-label" }, tab.label)
						)
					),
					overflow.length > 0
						? h(
								"button",
								{
									type: "button",
									className: "dsv-vmore",
									"data-active": activeInOverflow ? "1" : "0",
									"aria-label": "更多会话视图",
									"aria-haspopup": "menu",
									"aria-expanded": menuOpen ? "true" : "false",
									title: "更多会话视图",
									onClick: (event) => {
										const r = event.currentTarget.getBoundingClientRect();
										const up = placement === "bottom";
										setMenuPos({
											left: Math.round(r.left),
											top: up ? void 0 : Math.round(r.bottom + 4),
											bottom: up ? Math.round(window.innerHeight - r.top + 4) : void 0
										});
										setMenuOpen((open) => !open);
									}
								},
								"⋯"
							)
						: null,
				),
				menuOpen && overflow.length > 0
					? h(
							"div",
							{

								className: "dsv-vmenu",

								role: "menu",

								style:

									menuPos === null

										? void 0

										: { position: "fixed", left: `${menuPos.left}px`, top: menuPos.top === void 0 ? "auto" : `${menuPos.top}px`, bottom: menuPos.bottom === void 0 ? "auto" : `${menuPos.bottom}px` }

							},
							h("div", { className: "dsv-vmenu-head" }, "更多会话视图"),
							...overflow.map((tab) =>
								h(
									"button",
									{
										key: tab.id,
										type: "button",
										role: "menuitemradio",
										className: "dsv-vmenu-item",
										"data-active": tab.id === activeId ? "1" : "0",
										"aria-checked": tab.id === activeId ? "true" : "false",
										onClick: () => pick(tab.id)
									},
									h("span", { className: "dsv-vmenu-check", "aria-hidden": "true" }, tab.id === activeId ? "✓" : ""),
									h("span", { className: "dsv-vmenu-label" }, tab.label)
								)
							)
						)
					: null
			);
		}
		//#endregion
		/**
		 * 视图条的设置面板：位置（关/顶部/底部）+ 逐项显示开关 + 排序。
		 *
		 * 列表直接读宿主注册表，所以别的插件后来加的视图会自动出现在这里，
		 * 用户可以单独关掉它 —— 这就是「兼容任意插件」在设置侧的落点。
		 *
		 * 排序用上下箭头而不是拖拽：拖拽在滚动容器里和宿主的拖放机制打架，
		 * 而且键盘用户按不动。箭头慢一点，但不会误操作。
		 */
		function ViewBarControls(props) {
			const p = props.prefs;
			const tabs = useViewTabs();
			const order = p.viewBarOrder;
			const hidden = p.viewBarHidden;
			const arranged = arrangeViewTabs(tabs, order, hidden);
			const all = [...arranged.shown, ...arranged.folded];

			const isHidden = (id) => hidden.indexOf(id) >= 0;
			const toggle = (id) => {
				const next = isHidden(id) ? hidden.filter((entry) => entry !== id) : [...hidden, id];
				prefs.update({ viewBarHidden: next });
			};
			const move = (id, delta) => {
				/* 以「当前显示顺序」为基准重排，再写回完整 order ——
				   否则没被手动排过的项在下次读取时会跳位。 */
				const ids = all.map((tab) => tab.id);
				const from = ids.indexOf(id);
				const to = from + delta;
				if (from < 0 || to < 0 || to >= ids.length) return;
				ids.splice(to, 0, ids.splice(from, 1)[0]);
				prefs.update({ viewBarOrder: ids });
			};
			const reset = () => prefs.update({ viewBarOrder: [], viewBarHidden: [] });

			const PLACEMENT_LABEL = { off: "不显示", top: "顶部", bottom: "底部" };

			return [
				h(
					"div",
					{ className: "dsv-card dsv-card-col", key: "viewbar-place" },
					h(
						"div",
						{ className: "dsv-card-text" },
						h("div", { className: "dsv-card-title" }, "会话视图切换条"),
						h(
							"div",
							{ className: "dsv-card-desc" },
							"每个栏顶部（或底部）的视图切换条。内容**完全来自宿主当前的视图注册表**，不写死任何一项 —— 应用自带的（对话 / 轨迹 / 上下文 …）和任何插件自己注册的视图都算；新插件装上、或已有插件在运行时注册了新视图，切换条会自动出现那一项，不需要升级本插件。下面列表里的每一项都能单独开关、上下排序。"
						)
					),
					h(
						"div",
						{ className: "dsv-swatches", role: "radiogroup", "aria-label": "视图切换条位置" },
						/* 用户口径 2026-11-08：位置里不再提供「不显示」—— 关掉切换条由上面那个独立开关负责
						   （它内部仍用 viewBarPlacement="off" 表示关闭）。当前处于 off 时选中态按「顶部」显示，
						   免得两个按钮都不高亮。 */
						VIEWBAR_PLACEMENTS.filter((id) => id !== "off").map((id) =>
							h(
								"button",
								{
									key: id,
									type: "button",
									className: "dsv-swatch dsv-placement",
									role: "radio",
									"aria-checked": (p.viewBarPlacement === "off" ? "top" : p.viewBarPlacement) === id ? "true" : "false",
									"data-on": (p.viewBarPlacement === "off" ? "top" : p.viewBarPlacement) === id ? "1" : "0",
									title: PLACEMENT_LABEL[id],
									onClick: () => prefs.update({ viewBarPlacement: id })
								},
								h("span", { className: "dsv-swatch-name" }, PLACEMENT_LABEL[id])
							)
						)
					)
				),
				p.viewBarPlacement === "off"
					? null
					: h(
							"div",
							{ className: "dsv-card dsv-card-col", key: "viewbar-list" },
							h(
								"div",
								{ className: "dsv-card-text" },
								h("div", { className: "dsv-card-title" }, "显示哪些视图、什么顺序"),
								h(
									"div",
									{ className: "dsv-card-desc" },
									`共发现 ${tabs.length} 个已注册视图。关掉的会被收进「…」按钮，点开还能选；顺序决定它们在条上的先后。`
								)
							),
							h(
								"div",
								{ className: "dsv-viewlist", role: "list" },
								all.length === 0
									? h("div", { className: "dsv-viewlist-empty" }, "宿主还没有注册任何会话视图。")
									: all.map((tab, index) =>
											h(
												"div",
												{ className: "dsv-viewrow", role: "listitem", key: tab.id, "data-hidden": isHidden(tab.id) ? "1" : "0" },
												h("button", {
													type: "button",
													className: "dsv-viewcheck",
													role: "switch",
													"aria-checked": isHidden(tab.id) ? "false" : "true",
													"data-on": isHidden(tab.id) ? "0" : "1",
													title: isHidden(tab.id) ? "点击显示" : "点击隐藏（收进「…」）",
													onClick: () => toggle(tab.id),
													"aria-label": `显示 ${tab.label}`
												}),
												h("span", { className: "dsv-viewname" }, tab.label),
												h("span", { className: "dsv-viewid" }, tab.id),
												h("span", { className: "dsv-viewmove" },
													h("button", { type: "button", className: "dsv-viewarrow", disabled: index === 0 ? "disabled" : void 0, title: "上移", "aria-label": `上移 ${tab.label}`, onClick: () => move(tab.id, -1) }, "↑"),
													h("button", { type: "button", className: "dsv-viewarrow", disabled: index === all.length - 1 ? "disabled" : void 0, title: "下移", "aria-label": `下移 ${tab.label}`, onClick: () => move(tab.id, 1) }, "↓")
												)
											)
										)
							),
							order.length > 0 || hidden.length > 0
								? h("button", { type: "button", className: "dsv-linkbtn", onClick: reset }, "恢复默认顺序与显示")
								: null
						)
			];
		}

		/**
		 * 「分割线与焦点线」三项设置的共享渲染器（颜色 / 粗细 / 不透明度）。
		 *
		 * 插件自己的设置页和宿主设置分区都用同一个组件 —— 否则每加一项要在两处
		 * 各写一遍，早晚不同步（这次加不透明度就是）。
		 *
		 * @param props.prefs - 当前 prefs 快照。
		 */
		function LineControls(props) {
			const p = props.prefs;
			return [
				h(
					"div",
					{ className: "dsv-card dsv-card-col", key: "color" },
					h(
						"div",
						{ className: "dsv-card-text" },
						h("div", { className: "dsv-card-title" }, "分割线与焦点线颜色"),
						h("div", { className: "dsv-card-desc" }, "栏与栏之间的分隔条、拖动时的预览虚线框、焦点标签底部那条线，统一用这个颜色。")
					),
					h(
						"div",
						{ className: "dsv-swatches", role: "radiogroup", "aria-label": "分割线颜色" },
						LINE_COLORS.map((item) =>
							h(
								"button",
								{
									key: item.id,
									type: "button",
									className: "dsv-swatch",
									role: "radio",
									"aria-checked": p.lineColor === item.id ? "true" : "false",
									"data-on": p.lineColor === item.id ? "1" : "0",
									title: `${item.name} ${item.hex}`,
									style: { "--swatch": item.hex },
									onClick: () => prefs.update({ lineColor: item.id })
								},
								h("span", { className: "dsv-swatch-dot", "aria-hidden": "true" }),
								h("span", { className: "dsv-swatch-name" }, item.name)
							)
						)
					)
				),
				h(
					"div",
					{ className: "dsv-card dsv-card-col", key: "opacity" },
					h(
						"div",
						{ className: "dsv-card-text" },
						h("div", { className: "dsv-card-title" }, "分割线不透明度"),
						h(
							"div",
							{ className: "dsv-card-desc" },
							`分隔条平时显示得有多浓。悬停或拖动分隔条时始终是实色，方便对准。当前 ${Math.round(lineAlpha(p.lineOpacity) * 100)}%。`
						)
					),
					h(
						"div",
						{ className: "dsv-swatches", role: "radiogroup", "aria-label": "分割线不透明度" },
						LINE_OPACITIES.map((item) =>
							h(
								"button",
								{
									key: item.id,
									type: "button",
									className: "dsv-swatch dsv-opacity",
									role: "radio",
									"aria-checked": p.lineOpacity === item.id ? "true" : "false",
									"data-on": p.lineOpacity === item.id ? "1" : "0",
									title: `${item.name} ${Math.round(item.alpha * 100)}%`,
									onClick: () => prefs.update({ lineOpacity: item.id })
								},
								h("span", {
									className: "dsv-opacity-bar",
									"aria-hidden": "true",
									style: { background: withAlpha(lineColorHex(p.lineColor), item.alpha) }
								}),
								h("span", { className: "dsv-swatch-name" }, `${item.name} ${Math.round(item.alpha * 100)}%`)
							)
						)
					)
				),
				h(
					"div",
					{ className: "dsv-card dsv-card-col", key: "width" },
					h(
						"div",
						{ className: "dsv-card-text" },
						h("div", { className: "dsv-card-title" }, "线条粗细"),
						h("div", { className: "dsv-card-desc" }, "分隔条、焦点线、拖动预览虚线框统一使用这个粗细。")
					),
					h(
						"div",
						{ className: "dsv-swatches", role: "radiogroup", "aria-label": "线条粗细" },
						LINE_WIDTHS.map((item) =>
							h(
								"button",
								{
									key: item.id,
									type: "button",
									className: "dsv-swatch dsv-width",
									role: "radio",
									"aria-checked": p.lineWidth === item.id ? "true" : "false",
									"data-on": p.lineWidth === item.id ? "1" : "0",
									title: `${item.name} ${item.px}px`,
									onClick: () => prefs.update({ lineWidth: item.id })
								},
								h("span", { className: "dsv-width-bar", "aria-hidden": "true", style: { height: `${item.px}px` } }),
								h("span", { className: "dsv-swatch-name" }, `${item.name} ${item.px}px`)
							)
						)
					)
				)
			];
		}

		function SettingsPage(props) {
			const { onEnter, onExit } = props;
			const p = usePrefs();
			/* 用户口径 2026-11-08：在**这个**设置页里拨主开关，只改状态，**不要退出设置页**。
			   之前是 `if (next) onEnter(); else onExit();` —— 开也走、关也走，
			   拨一下页面就跳走（用户原话「开 关插件，都会立刻退出设置，这不对」）。
			   参照物是宿主系统设置里那个「多栏插件」分区：拨开关只改状态、页面留着。
			   `onEnter`/`onExit` 仍保留给页面底部「进入会话」按钮（那是明确的离开动作）。 */
			const toggle = () => {
				prefs.update({ enabled: !p.enabled });
			};
			return h(
				"div",
				{ className: "dsv-settings" },
				h(
					"div",
					{ className: "dsv-settings-inner" },
					h("h2", null, PLUGIN_LABEL),
					h(
						"p",
						null,
						"把对话区改成 Hermes 式工作区：顶部一条标签栏，可以并排显示多个会话，每个会话都有自己的输入框、工具调用和插件面板。"
					),
					h(
						"div",
						{ className: "dsv-card" },
						h(
							"div",
							{ className: "dsv-card-text" },
							h("div", { className: "dsv-card-title" }, `启用${PLUGIN_LABEL}`),
							h(
								"div",
								{ className: "dsv-card-desc" },
								p.enabled ? "已启用：打开 App 直接进入工作区，点左侧会话替换当前标签。" : "未启用：保持原生单栏对话界面。"
							)
						),
						h("button", {
							type: "button",
							className: "dsv-switch",
							"data-on": p.enabled ? "1" : "0",
							role: "switch",
							"aria-checked": p.enabled ? "true" : "false",
							"aria-label": `启用${PLUGIN_LABEL}`,
							onClick: toggle
						})
					),
					/* 会话头开关（用户口径 2026-11-08）：标准模式 / 费用明细 / 子智能体 /
					   右侧那组按钮，可以整条关掉，给窄栏腾空间。 */
					h(
						"div",
						{ className: "dsv-card" },
						h(
							"div",
							{ className: "dsv-card-text" },
							h("div", { className: "dsv-card-title" }, "显示会话头"),
							h(
								"div",
								{ className: "dsv-card-desc" },
								p.hostBar === false
									? "已关闭：每栏不显示标题 / 标准模式 / 子智能体 / 右侧按钮那一行。"
									: "已开启：每栏顶部显示标题、标准模式、子智能体、右侧按钮那一行。"
							)
						),
						h("button", {
							type: "button",
							className: "dsv-switch",
							"data-on": p.hostBar === false ? "0" : "1",
							role: "switch",
							"aria-checked": p.hostBar === false ? "false" : "true",
							"aria-label": "显示会话头",
							onClick: () => prefs.update({ hostBar: p.hostBar === false })
						})
					),
					/* 视图切换条：开关 + 位置 + 逐项列表，三块连在一起
					   （用户口径 2026-11-08：开关和它的具体设置必须挨着，原来中间隔着别的卡）。 */
					h(
						"div",
						{ className: "dsv-card", key: "viewbar-switch" },
						h(
							"div",
							{ className: "dsv-card-text" },
							h("div", { className: "dsv-card-title" }, "显示视图切换条"),
							h(
								"div",
								{ className: "dsv-card-desc" },
								p.viewBarPlacement === "off"
									? "已关闭：每栏不显示「对话 / 轨迹 / 上下文 …」那一行。"
									: "已开启：每栏显示「对话 / 轨迹 / 上下文 …」那一行。位置与显示哪些视图，见下面两项。"
							)
						),
						h("button", {
							type: "button",
							className: "dsv-switch",
							"data-on": p.viewBarPlacement === "off" ? "0" : "1",
							role: "switch",
							"aria-checked": p.viewBarPlacement === "off" ? "false" : "true",
							"aria-label": "显示视图切换条",
							onClick: () =>
								prefs.update({ viewBarPlacement: p.viewBarPlacement === "off" ? "top" : "off" })
						})
					),
					...ViewBarControls({ prefs: p }),
					/* 双击关闭标签开关 */
					h(
						"div",
						{ className: "dsv-card" },
						h(
							"div",
							{ className: "dsv-card-text" },
							h("div", { className: "dsv-card-title" }, "双击关闭标签"),
							h(
								"div",
								{ className: "dsv-card-desc" },
								p.dblclickClose === false
									? "已关闭：双击标签不关闭（中键、× 仍然可用）。"
									: "已开启：双击标签直接关闭（中键、× 也可用）。"
							)
						),
						h("button", {
							type: "button",
							className: "dsv-switch",
							"data-on": p.dblclickClose === false ? "0" : "1",
							role: "switch",
							"aria-checked": p.dblclickClose === false ? "false" : "true",
							"aria-label": "双击关闭标签",
							onClick: () => prefs.update({ dblclickClose: p.dblclickClose === false })
						})
					),
					/* 侧边栏入口开关：默认显示。关掉后侧栏不再出现本插件入口，
					   但设置页仍在（从宿主设置里进来），不会把自己锁死。 */
					h(
						"div",
						{ className: "dsv-card" },
						h(
							"div",
							{ className: "dsv-card-text" },
							h("div", { className: "dsv-card-title" }, "在侧边栏显示入口"),
							h(
								"div",
								{ className: "dsv-card-desc" },
								p.showInSidebar === false
									? "已关闭：侧边栏不显示本插件入口。"
									: "已开启：侧边栏显示本插件入口（默认）。"
							)
						),
						h("button", {
							type: "button",
							className: "dsv-switch",
							"data-on": p.showInSidebar === false ? "0" : "1",
							role: "switch",
							"aria-checked": p.showInSidebar === false ? "false" : "true",
							"aria-label": "在侧边栏显示入口",
							onClick: () => prefs.update({ showInSidebar: p.showInSidebar === false })
						})
					),
					/* 外观一组单独起标题：8 张卡平铺时分不清哪几张是一组 */
					h("div", { className: "dsv-group-title", key: "grp-line" }, "分隔线外观"),
					...LineControls({ prefs: p }),
					h(
						"p",
						null,
						"用法：点左侧会话替换当前标签；把会话拖到标签栏或对话区会新开标签；拖到两栏之间的分隔条上会在那里拆出新的一栏。标签支持中键关闭；右键标签可锁定，锁定后只能右键解锁才能关闭。"
					),
					h("p", { className: "dsv-hint" }, "布局和启用状态保存在本机浏览器存储里；升级插件或重启 App 后会原样恢复。")
					,
					/* 底部「进入会话」：最面一个，和顶部那个同义。 */
					h(
						"div",
						{
							/* 用 div + role=button 而不是原生 button：对照实验证明同样的盒子
							   换成 div（fixed 放 body 下）就完全正常，而 button 在设置页容器里
							   只被绘制了 38% 宽度、文字一个像素都没画。Chromium 对表单控件
							   有独立渲染路径，绕开它最省事。 */
							role: "button",
							tabIndex: 0,
							className: "dsv-enter dsv-enter-bottom",
							title: "回到会话（退出设置）",
							onClick: onEnter,
							onKeyDown: (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onEnter(); } }
						},
						h("span", { className: "dsv-enter-label" }, "进入会话")
					)
				)
			);
		}

		/**
		 * The same switch, rendered as a section inside the host settings dialog.
		 */
		function SettingsSection() {
			const p = usePrefs();
			const toggle = () => {
				const next = !p.enabled;
				prefs.update({ enabled: next, showSettings: false });
				if (next) selectPanel(NATIVE_PANEL);
				else selectPanel(null);
			};
			/* 宿主设置对话框里的这个分区要和插件自己的设置页**内容一致** ——
			   曾只放一个「启用」开关，用户在系统设置里根本看不到颜色/线宽这些项，
			   以为设置不全（2026-11-07 反馈）。这里补齐主开关 + 侧栏入口 + 双击关闭
			   + 颜色 + 线宽，另外给一个跳转到完整设置页的按钮。 */
			const switchCard = (title, desc, on, ariaLabel, onClick) =>
				h(
					"div",
					{ className: "dsv-card" },
					h(
						"div",
						{ className: "dsv-card-text" },
						h("div", { className: "dsv-card-title" }, title),
						h("div", { className: "dsv-card-desc" }, desc)
					),
					h("button", {
						type: "button",
						className: "dsv-switch",
						"data-on": on ? "1" : "0",
						role: "switch",
						"aria-checked": on ? "true" : "false",
						"aria-label": ariaLabel,
						onClick
					})
				);
			return h(
				"div",
				{ style: { display: "flex", flexDirection: "column", gap: "16px" } },
				h(
					"p",
					{ style: { margin: 0, fontSize: "13px", lineHeight: 1.65, opacity: 0.72 } },
					"启用后，对话区会变成 Hermes 式工作区：顶部一条标签栏，可并排多个会话，每个会话都有独立输入框。"
				),
				switchCard(`启用${PLUGIN_LABEL}`, p.enabled ? "已启用" : "未启用（保持原生单栏对话）", p.enabled === true, `启用${PLUGIN_LABEL}`, toggle),
				switchCard(
					"在侧边栏显示入口",
					p.showInSidebar === false ? "已关闭：侧边栏不显示本插件入口。" : "已开启：侧边栏显示本插件入口（默认）。",
					p.showInSidebar !== false,
					"在侧边栏显示入口",
					() => prefs.update({ showInSidebar: p.showInSidebar === false })
				),
				switchCard(
					"双击关闭标签",
					p.dblclickClose === false ? "已关闭：双击标签不关闭（中键、× 仍然可用）。" : "已开启：双击标签直接关闭（中键、× 也可用）。",
					p.dblclickClose !== false,
					"双击关闭标签",
					() => prefs.update({ dblclickClose: p.dblclickClose === false })
				),
				...ViewBarControls({ prefs: p }),
				/* 颜色 / 不透明度 / 粗细：与插件设置页共用一个渲染器 */
				...LineControls({ prefs: p }),
				/* 宿主设置对话框里的这个分区也要有「进入会话」——
				   用户要求两个入口（侧边栏入口、我的设置）都能一键回会话。 */
				h(
					"button",
					{
						type: "button",
						className: "dsv-enter dsv-enter-top",
						title: "回到会话（退出设置）",
						onClick: () => selectPanel(NATIVE_PANEL)
					},
					"进入会话"
				)
			);
		}

		/**
		 * The workspace itself: a row of panes, draggable dividers between them, and
		 * document-level bridges for dragging sessions in from the sidebar tree.
		 */
		function WorkspacePanel(props) {
			const { renderFactorySlot, SessionProvider, renderSlot } = props;
			/* 订阅 prefs：设置页换分割线颜色后，这里要立刻重渲染把 --dsv-line 换掉。 */
			const prefsSnapshot = usePrefs();
			const sessions = resolveSessions();
			const rowMap = useRowMap(sessions);

			// A service can still be materialising when apply() runs; re-render once it
			// shows up instead of being stuck with an empty session list forever.
			const [, retry] = react.useReducer((n) => n + 1, 0);
			react.useEffect(() => {
				if (sessions !== void 0) return;
				let tries = 0;
				const timer = setInterval(() => {
					tries += 1;
					if (resolveSessions() !== void 0) {
						clearInterval(timer);
						retry();
					} else if (tries > 40) clearInterval(timer);
				}, 250);
				return () => clearInterval(timer);
			}, [sessions]);

			const [state, setState] = react.useState(readState);
			/* 会话状态（running / unreadDone）变化的触发器。
			   statusStore 是普通对象，直接改它 React 不知道 → 标签圆点不刷新。
			   每次 compute 里状态真的变了就 bump 一次，强制重渲染。 */
			const [statusTick, setStatusTick] = react.useState(0);
			/* 侧栏行标记：焦点会话 / 已打开会话 / 运行中。必须在 state 之后调用。 */
			useSidebarRowMarks(state, sessions, () => setStatusTick((n) => n + 1));
			/* 把当前分栏状态暴露到 window，供 apply 层的常驻标记循环使用 ——
			   进设置页后 WorkspaceRoot 会卸载，这个引用必须留在外面。 */
			react.useEffect(() => {
				window.__dsvState = state;
			}, [state]);
			/* ── 焦点标签 = 宿主的「当前会话」───────────────────────────────
			 * 规则（2026-11-08 定案）：多栏里"当前会话"永远指焦点栏的激活标签。
			 *
			 * 为什么必须走 replaceMain，不能写 sidebarRight.mounted：
			 *   实测 mounted.set(sid) 只改了镜像值 —— mounted 快照变了，但右栏
			 *   页签条完全不重渲（tabs 仍是 4 个、内容长度不变）；
			 *   换成 replaceMain(sid) 之后页签条立刻按新会话重建（实测 2→4 个）。
			 *
			 * 一处对齐，处处正确：宿主所有「按当前会话取数」的东西都跟着对 ——
			 * 右侧栏（上下文诊断 / 子智能体 / 引导页，openTabs 里每项都带
			 * sessionId，本身就是 per-session）、底部面板（betterSidebar 的
			 * getSnapshot 也带 sessionId）、以及以后任何读 uiSession.adapter.current
			 * 的功能。这就是用户要的「举一反三」。
			 */
			const focusSessionOf = (snapshot) => {
				const fp = snapshot.panes.find((pane) => pane.id === snapshot.focusPaneId) ?? snapshot.panes[0];
				if (fp === void 0) return "";
				const ft = fp.tabs.find((tab) => tab.id === fp.activeTabId) ?? fp.tabs[0];
				return ft !== void 0 && typeof ft.sessionId === "string" ? ft.sessionId : "";
			};
			const focusKey = focusSessionOf(state);
			const syncRef = react.useRef({ done: "", timer: 0, abort: null });
			react.useEffect(() => {
				if (prefs.state.enabled !== true) return;
				if (focusKey === "") return;
				const st = syncRef.current;
				if (st.done === focusKey) return;
				window.clearTimeout(st.timer);
				/* 防抖 120ms：拖标签 / 拖分隔条时焦点会高频跳变，只认最后一次。 */
				st.timer = window.setTimeout(() => {
					try {
						const workspace = SERVICES.ctx?.get?.("uiWorkspace");
						if (workspace === void 0 || workspace === null || typeof workspace.replaceMain !== "function") return;
						const cur = SERVICES.ctx?.get?.("uiSession")?.adapter?.current?.getSnapshot?.();
						if (cur !== void 0 && cur !== null && cur.key === focusKey) {
							st.done = focusKey;
							return;
						}
						const col = document.querySelector(".mP3x-q_rightbarCol");
						const wasOpen = col !== null && col.getBoundingClientRect().width > 1;
						/* 决策 2b 的兜底素材：切换**前**右栏是不是正开着一个会话相关内容。
						   记下来是为了「切到一个从没开过侧栏的会话」时，能沿用同一种类型，
						   而不是给用户一个空栏。 */
						const hadSessionScoped = col !== null && /Token 统计|缓存命中|子智能体/.test(col.innerText);
						st.abort?.abort?.();
						const ac = new AbortController();
						st.abort = ac;
						workspace.replaceMain(focusKey, ac.signal, "keep");
						st.done = focusKey;
						/* 决策 3b：右栏保持展开，只换内容。
						   目标会话自己的 layout.expanded 多半是 false（它从没开过右栏），
						   宿主的 syncPresentation 会顺手把栏收起 —— 用户切个标签就看到
						   「右栏突然消失」。这里把「开/关」这个用户动作和「显示谁的内容」
						   解耦：同步后若发现被收起，补一次开。 */
						if (wasOpen === true && hadSessionScoped === true) {
							/* 决策 2b：宿主的页签本身就是 per-session 的（openTabs 每项带
							   sessionId），所以切到一个从没开过侧栏的会话时，右栏会是空的。
							   这时沿用「刚才在看同一类内容」的语义，替用户把它打开 ——
							   跟「切换标签，侧栏就该刷新成对应标签的内容」是同一个意思。 */
							window.setTimeout(() => {
								try {
									if (document.querySelectorAll("[data-sidebar-right-tab]").length > 0) return;
									const pane = document.querySelector('.dsv-pane[data-focus="1"]') ?? document.querySelector(".dsv-pane");
									const btn = pane === null ? null : pane.querySelector(".dsv-hostbar [data-dsh-ctx-entry]");
									btn?.click?.();
								} catch {
									/* 忽略 */
								}
							}, 900);
						}
						if (wasOpen === true) {
							/* 无条件补开（openRightbar 幂等），而且打两拍：
							   实测只打一拍（280ms）时，宿主收起动画还没结束、列宽仍在
							   576→0 的路上，那次「width<=1 才补」判断为 false → 不补，
							   结果切回原标签时右栏就真的关上了（实测 colW 576→0）。 */
							for (const delay of [280, 720]) {
								window.setTimeout(() => {
									try {
										SERVICES.layout?.panels?.openRightbar?.(true, false);
									} catch {
										/* 忽略 */
									}
								}, delay);
							}
						}
					} catch (error) {
						console.warn("[split-view] 同步焦点会话失败:", error);
					}
				}, 120);
			}, [focusKey, state]);
			react.useEffect(() => () => window.clearTimeout(syncRef.current.timer), []);

			/* statusTick 本身不直接渲染，但必须出现在渲染路径里，
			   否则 React 可能跳过本次更新的下游（见下面 panes 的依赖）。 */
			void statusTick;
			const [dragging, setDragging] = react.useState(false);
			/* What would happen if the pointer were released right now. `null` while no
			   drag is over anything; `{paneId, side}` for a pane (side null = add a tab),
			   `{index, kind:"divider"}` for a divider. Drives the drop preview only. */
			const [hover, setHover] = react.useState(null);
			const setHoverDrop = react.useCallback((next) => {
				setHover((prev) => {
					if (prev === next) return prev;
					if (prev !== null && next !== null && prev.paneId === next.paneId && prev.index === next.index && prev.side === next.side && prev.kind === next.kind) return prev;
					return next;
				});
			}, []);
			const [narrow, setNarrow] = react.useState(false);
			const rootRef = react.useRef(null);
			/* Read by the panel hook, which fires outside React's render cycle. */
			const stateRef = react.useRef(state);
			stateRef.current = state;
			LIVE_STATE = state;

			const apply = react.useCallback((mutate) => {
				setState((prev) => {
					const next = mutate(prev);
					return next === prev ? prev : next;
				});
			}, []);
			LIVE_APPLY = apply;

			// Persist on a short debounce: a divider drag produces a state change per
			// pointer move and localStorage is synchronous.
			react.useEffect(() => {
				const timer = setTimeout(() => writeState(state), 200);
				return () => clearTimeout(timer);
			}, [state]);

			// First paint: pick up a session click that arrived while this panel was
			// not mounted, otherwise start on the session the host already selected so
			// enabling the workspace lands on a single real tab, not a blank one.
			react.useEffect(() => {
				const queued = pendingOpen.sessionId;
				pendingOpen.sessionId = null;
				let current = null;
				try {
					current = resolveWorkspaceService()?.selection?.getSnapshot?.()?.sessionId ?? null;
				} catch {
					current = null;
				}
				const seed = typeof queued === "string" && queued !== "" ? queued : current;
				if (typeof seed !== "string" || seed === "") return;
				setState((prev) => {
					const showsSomething = prev.panes.some((pane) => pane.tabs.some((tab) => tab.sessionId !== null));
					if (showsSomething && queued === null) return prev;
					return openSession(prev, seed, "replace");
				});
			}, []);

			// The desktop app runs a hidden title bar and lets Windows paint the window
			// buttons straight onto the page (titleBarOverlay). Those pixels are not
			// part of the DOM, so they win every click: the last tab strip has to stop
			// short of them. Measured rather than assumed, because the host pads the
			// frame below the title bar on some builds and not on others.
			const [captionInset, setCaptionInset] = react.useState(0);
			react.useEffect(() => {
				const measure = () => {
					const node = rootRef.current;
					const overlay = typeof navigator !== "undefined" ? navigator.windowControlsOverlay : void 0;
					if (node === null || overlay === void 0 || overlay === null || overlay.visible !== true) {
						setCaptionInset(0);
						return;
					}
					let area = null;
					try {
						area = typeof overlay.getTitlebarAreaRect === "function" ? overlay.getTitlebarAreaRect() : null;
					} catch {
						area = null;
					}
					if (area === null || !(area.height > 0)) {
						setCaptionInset(0);
						return;
					}
					// 标签条现在固定在窗口顶端（position:fixed, top:0），所以**总是**与
					// 系统窗口按钮同一条带，必须一直让位。以前那句“frame 已经在标题栏
					// 下方就不用让位”的判断已经不成立，删掉，否则最右一栏的按钮会被
					// 最小化/关闭盖住。
					// The titlebar area is the zone the app may paint in; the window
					// buttons sit to the RIGHT of it, so the strip has to give up
					// `innerWidth - (x + width)` pixels. Subtracting `x` alone measures
					// the whole window, which then trips the half-width guard below and
					// leaves the inset at 0 forever — the exact bug that had the last
					// pane's ⊞/⊟/⚙ sitting under the minimise/close buttons.
					const right = typeof area.width === "number" ? area.x + area.width : area.x;
					const inset = Math.round(window.innerWidth - right);
					setCaptionInset(inset > 0 && inset < window.innerWidth / 2 ? inset : 0);
				};
				measure();
				window.addEventListener("resize", measure);
				return () => window.removeEventListener("resize", measure);
			}, []);

			/* 宿主标题栏让出的高度（桌面版实测 40px，web 端 0）。标签条固定在窗口顶端后，
			   每栏正文要给它留位置，留多少 = 45 - 这段偏移。 */
			const [hostOffset, setHostOffset] = react.useState(0);
			react.useEffect(() => {
				const measure = () => {
					const node = rootRef.current;
					if (node === null) return;
					const top = Math.round(node.getBoundingClientRect().top);
					setHostOffset(top > 0 && top <= 60 ? top : 0);
				};
				measure();
				const timer = setTimeout(measure, 400);
				window.addEventListener("resize", measure);
				return () => {
					clearTimeout(timer);
					window.removeEventListener("resize", measure);
				};
			}, []);

			react.useEffect(() => {
				bridge.open = (sessionId) => {
					bridge.routing = true;
					try {
						setState((prev) => openSession(prev, sessionId, "replace"));
					} finally {
						bridge.routing = false;
					}
				};
				/* A freshly created session belongs in a NEW tab next to what the user
				   already had — replacing their conversation with a blank one is not
				   what 「新建会话」 means. */
				bridge.openTab = (sessionId) => {
					bridge.routing = true;
					try {
						setState((prev) => openSession(prev, sessionId, "tab"));
					} finally {
						bridge.routing = false;
					}
				};
				/* A brand-new session has no id the plugin can rely on yet, and a blank
				   tab is what the native view would have shown anyway. */
				bridge.blank = () => {
					bridge.routing = true;
					try {
						setState((prev) => addBlankTab(prev, prev.focusPaneId));
					} finally {
						bridge.routing = false;
					}
				};
				/* 把「当前标签」的会话换成新会话 id（不新增标签）。
				   用于「关掉最后一个标签」→ 应该是干净的新会话，而不是空白标签 + 旧内容残留。 */
				bridge.replaceTab = (sessionId) => {
					if (typeof sessionId !== "string" || sessionId === "") return;
					bridge.routing = true;
					try {
						setState((prev) => {
							const pane = prev.panes.find((candidate) => candidate.id === prev.focusPaneId) ?? prev.panes[0];
							if (pane === void 0) return prev;
							const target = pane.tabs.find((tab) => tab.id === pane.activeTabId) ?? pane.tabs[0];
							if (target === void 0) return prev;
							return {
								...prev,
								panes: prev.panes.map((item) =>
									item.id === pane.id
										? { ...item, tabs: item.tabs.map((tab) => (tab.id === target.id ? { ...tab, sessionId } : tab)), activeTabId: target.id }
										: item
								)
							};
						});
					} finally {
						bridge.routing = false;
					}
				};
				bridge.focusedSession = () => {
					const current = stateRef.current;
					const pane = current.panes.find((candidate) => candidate.id === current.focusPaneId) ?? current.panes[0];
					const tab = pane?.tabs.find((candidate) => candidate.id === pane.activeTabId) ?? pane?.tabs[0];
					return tab?.sessionId ?? null;
				};
				return () => {
					bridge.open = null;
					bridge.openTab = null;
					bridge.blank = null;
					bridge.replaceTab = null;
					bridge.focusedSession = null;
				};
			}, []);

			// Drag-in from the sidebar tree: the rows carry data-row-key but the host
			// puts nothing into dataTransfer, so the id is captured here instead.
			react.useEffect(() => {
				const onDragStart = (event) => {
					const target = event.target;
					if (!(target instanceof Element)) return;
					if (target.closest(".dsv-tab") !== null) return;
					const row = target.closest('[data-row-key^="session:"]');
					if (row === null) return;
					const key = row.getAttribute("data-row-key") ?? "";
					drag.sessionId = key.slice("session:".length);
					drag.tab = null;
					setDragging(true);
				};
				const onDragEnd = () => {
					drag.sessionId = null;
					drag.tab = null;
					setDragging(false);
					setHoverDrop(null);
				};
				document.addEventListener("dragstart", onDragStart, true);
				document.addEventListener("dragend", onDragEnd, true);
				return () => {
					document.removeEventListener("dragstart", onDragStart, true);
					document.removeEventListener("dragend", onDragEnd, true);
				};
			}, []);

			/* 拖拽期间把标签条那块像素从「系统标题栏带」借给网页：
			   闲时整条 app-region:drag（拖窗口/双击最大化），有拖拽在飞就切 no-drag（能接投放）。
			   复位三重 + 超时兜底：drop / dragend / dragleave(离开窗口) / 1500ms 无 dragover。 */
			react.useEffect(() => {
				const root = rootRef.current;
				if (root === null) return undefined;
				let armTimer = 0;
				let settleFrame = 0;
				/* ⚠️ 实测（2026-11-07）：只改 -webkit-app-region 不会让 Chromium 重算窗口的可拖动区，
				   系统那边照样报 HTCAPTION，dragover 依旧进不来。必须同时制造一次真实重排
				   （改 padding-right ±1px 最省，肉眼不可见）才会触发 DraggableRegionsChanged。
				   证据：arm 后 app-region 的 computed 已是 no-drag，但 WM_NCHITTEST 仍 HTCAPTION；
				   随手改一下 header 高度/left/padding-right，立刻变 HTCLIENT。 */
				const nudge = () => {
					/* 用 padding-LEFT 制造 1px 重排：不碰 padding-right，
					   因为最右栏的 padding-right 由 CSS 里的 :last-child 规则负责让位，
					   在这里覆盖会把让位弄丢（窗口按钮又会盖住 + 号）。 */
					const heads = root.querySelectorAll(".dsv-paneheader");
					for (const head of heads) {
						head.style.paddingLeft =
							root.getAttribute("data-drop-armed") === null ? "" : "calc(8px + 1px)";
					}
				};
				const disarm = () => {
					if (armTimer !== 0) {
						window.clearTimeout(armTimer);
						armTimer = 0;
					}
					if (root.getAttribute("data-drop-armed") !== null) root.removeAttribute("data-drop-armed");
					nudge();
				};
				const arm = () => {
					const fresh = root.getAttribute("data-drop-armed") === null;
					if (fresh) root.setAttribute("data-drop-armed", "1");
					nudge();
					if (armTimer !== 0) window.clearTimeout(armTimer);
					// Esc 取消拖拽在 Windows 上不保证有 dragend，只能靠这个兜底复位。
					// 4s：拖拽期间 dragover 约每 350ms 重发一次，正常拖拽远不会走到这里；
					// 只有指针静止在非投放区时才靠它复位，留长一点避免拖到一半又变回标题栏。
					armTimer = window.setTimeout(disarm, 4000);
				};
				// drop 之后等两帧再复位：同一帧里可能还有后续 dragenter 打进来，
				// 立刻复位会让它重新撞回标题栏带。
				const disarmAfterFrame = () => {
					if (settleFrame !== 0) window.cancelAnimationFrame(settleFrame);
					settleFrame = window.requestAnimationFrame(() => {
						settleFrame = window.requestAnimationFrame(disarm);
					});
				};
				const onDragStart = () => arm();
				const onDragEnter = () => arm();
				const onDragOver = () => arm();
				const onDrop = () => {
					clearAllDropMarks();
					disarmAfterFrame();
				};
				const onDragEnd = () => {
					disarm();
					clearAllDropMarks();
				};
				const onDragLeave = (event) => {
					if (event.relatedTarget === null) disarm();
				};
				const onWindowBlur = () => disarm();
				document.addEventListener("dragstart", onDragStart, true);
				document.addEventListener("dragenter", onDragEnter, true);
				document.addEventListener("dragover", onDragOver, true);
				document.addEventListener("drop", onDrop, true);
				document.addEventListener("dragend", onDragEnd, true);
				document.addEventListener("dragleave", onDragLeave, true);
				window.addEventListener("blur", onWindowBlur);
				return () => {
					document.removeEventListener("dragstart", onDragStart, true);
					document.removeEventListener("dragenter", onDragEnter, true);
					document.removeEventListener("dragover", onDragOver, true);
					document.removeEventListener("drop", onDrop, true);
					document.removeEventListener("dragend", onDragEnd, true);
					document.removeEventListener("dragleave", onDragLeave, true);
					window.removeEventListener("blur", onWindowBlur);
					if (settleFrame !== 0) window.cancelAnimationFrame(settleFrame);
					disarm();
				};
			}, []);

			// Narrow layout switches from side-by-side to stacked.
			react.useEffect(() => {
				const node = rootRef.current;
				if (node === null || typeof ResizeObserver === "undefined") return;
				const observer = new ResizeObserver((entries) => {
					const width = entries[0]?.contentRect?.width ?? node.getBoundingClientRect().width;
					/* 用窗口内宽而不是工作区宽度：工作区宽度会随栏数变化，
					   以前把某一栏拖窄会让整体宽度变小 → 误判成竖排。 */
					const viewport = window.innerWidth;
					const basis = viewport > 0 ? viewport : width;
					setNarrow(basis > 0 && basis < STACK_BREAKPOINT_PX);
				});
				observer.observe(node);
				return () => observer.disconnect();
			}, []);

			const actions = react.useMemo(
				() => ({
					setHover: setHoverDrop,
					/* 拖标签也要进入“拖拽中”状态：标签条空白区平时是系统标题栏带（可拖窗口），
					   只有拖拽期间切成 no-drag 才能接住投放。 */
					tabDragStart: (paneId, tabId) => {
						drag.sessionId = null;
						drag.tab = { paneId, tabId };
						setDragging(true);
					},
					tabDragEnd: () => {
						drag.tab = null;
						setDragging(false);
						setHoverDrop(null);
					},
					/* 同栏内拖动标签：按插入位把标签挪到新位置（不新建栏、不换栏）。 */
					reorderTab: (paneId, tabId, index) => {
						drag.tab = null;
						drag.sessionId = null;
						setDragging(false);
						setHoverDrop(null);
						apply((prev) => reorderTab(prev, paneId, tabId, index));
					},
					focusPane: (paneId) => apply((prev) => (prev.focusPaneId === paneId ? prev : { ...prev, focusPaneId: paneId })),
					activateTab: (paneId, tabId) =>
						apply((prev) => ({
							...prev,
							focusPaneId: paneId,
							panes: prev.panes.map((pane) => (pane.id === paneId ? { ...pane, activeTabId: tabId } : pane))
						})),
					/* 关最后一个标签（唯一栏）时不能留 sessionId=null 的空白标签 ——
					   宿主会把焦点会话的内容渲染进空白标签，看起来是旧内容残留。
					   改为：走宿主新建会话流程，拿到新 id 后替换这个标签。
					   注意顺序：先 apply 一个占位（避免空白标签闪现），
					   但占位本身也会残留 —— 所以干脆不 apply，
					   直接触发新建；新会话到达后 replaceTab 换掉当前标签。 */
					closeTab: (paneId, tabId) => {
						const current = stateRef.current;
						const pane = current.panes.find((item) => item.id === paneId);
						const tab = pane?.tabs.find((item) => item.id === tabId);
						const isOnlyLastTab = current.panes.length === 1 && pane !== void 0 && pane.tabs.length === 1;
						if (isOnlyLastTab === true && tab !== void 0 && tab.locked !== true) {
							/* 最后一步再确认宿主可用，否则退回原来的空白标签行为。 */
							const workspace = resolveWorkspaceService();
							if (workspace !== void 0 && typeof workspace.startSession === "function") {
								pendingReplace.on = true;
								try {
									const result = workspace.startSession(void 0, {});
									if (result !== null && typeof result === "object" && typeof result.then === "function") {
										result.then(null, (error) => {
											console.warn("[split-view] last-tab new session rejected:", error);
											pendingReplace.on = false;
											apply((prev) => closeTab(prev, paneId, tabId));
										});
									}
									return;
								} catch (error) {
									pendingReplace.on = false;
									console.warn("[split-view] last-tab new session threw:", error);
								}
							}
						}
						apply((prev) => closeTab(prev, paneId, tabId));
					},
					toggleLock: (paneId, tabId) => apply((prev) => toggleLockTab(prev, paneId, tabId)),
					splitPane: (paneId) =>
						apply((prev) => {
							const index = prev.panes.findIndex((pane) => pane.id === paneId);
							/* 拆 paneId 自己，新栏放它右边。 */
							return index < 0 ? prev : insertPane(prev, index + 1, null, paneId);
						}),
					closePane: (paneId) => apply((prev) => closePane(prev, paneId)),
					openSettings: () => panelSelect(PANEL_ID),
					/* Deliberate exit: go through the helper so `selfSelect` is raised and
					   the panel hook lets the native switch through. */
					/* 「回到原生单栏」= 关掉插件（隐藏 WorkspaceRoot 即可） */
					exitToSingle: () => {
						prefs.update({ enabled: false });
						panelSelect(NATIVE_PANEL);
					},
					addBlankTab: (paneId) => apply((prev) => addBlankTab(prev, paneId)),
					/* 标签条上的「+」不能开一个 sessionId=null 的空白标签：那种标签
					   没有会话绑定，宿主的 conversation.content 会把**当前焦点会话**
					   的内容渲染进来（看得见内容、但没有输入框），2026-11-07 用户实测。
					   改成走宿主的「新建会话」流程（侧栏那个入口走的就是它：
					   uiWorkspace.startSession → … → layout.selectPanel(null)），
					   新会话的 id 由 installCreateHook 捕获、再由 selectPanel 钩子
					   foldNewSession 开成新标签 —— 与侧栏新建完全同一条路径。 */
					newTab: (paneId) => {
						apply((prev) => ({ ...prev, focusPaneId: paneId }));
						const workspace = resolveWorkspaceService();
						if (workspace !== void 0 && typeof workspace.startSession === "function") {
							try {
								const result = workspace.startSession(void 0, {});
								if (result !== null && typeof result === "object" && typeof result.then === "function") {
									result.then(null, (error) => {
										console.warn("[split-view] startSession rejected, falling back to a blank tab:", error);
										apply((prev) => addBlankTab(prev, paneId));
									});
								}
								return;
							} catch (error) {
								console.warn("[split-view] startSession threw, falling back to a blank tab:", error);
							}
						}
						apply((prev) => addBlankTab(prev, paneId));
					},
					dropOnPane: (paneId, side) => {
						// Capture before apply(): the state updater runs later, by which
						// time the drag bookkeeping has already been cleared.
						const sessionId = drag.sessionId;
						const tab = drag.tab;
						drag.sessionId = null;
						drag.tab = null;
						setDragging(false);
						if (tab !== null) {
							/* A tab dragged onto a pane's left/right edge becomes its own
							   pane on that side; dropped anywhere else it just joins. */
							apply((prev) => dropTab(prev, tab.paneId, tab.tabId, paneId, side));
						} else if (sessionId !== null && (side === "left" || side === "right")) {
							apply((prev) => {
								const index = prev.panes.findIndex((pane) => pane.id === paneId);
								if (index < 0) return prev;
								if (findSession(prev, sessionId) !== void 0) return prev;
								/* 左右都是在拆**目标栏自己**（paneId），不是拆它的邻居。 */
								return insertPane(prev, side === "left" ? index : index + 1, sessionId, paneId);
							});
						} else if (sessionId !== null) {
							apply((prev) => openSession(prev, sessionId, "tab", paneId));
						}
					},
					dropOnDivider: (index) => {
						const sessionId = drag.sessionId;
						const tab = drag.tab;
						if (tab !== null) {
							apply((prev) => {
								const from = prev.panes.find((pane) => pane.id === tab.paneId);
								const moved = from?.tabs.find((candidate) => candidate.id === tab.tabId);
								if (moved === void 0) return prev;
								const without = prev.panes.map((pane) =>
									pane.id === tab.paneId
										? { ...pane, tabs: pane.tabs.filter((candidate) => candidate.id !== tab.tabId), activeTabId: pane.activeTabId === tab.tabId ? null : pane.activeTabId }
										: pane
								);
								/* 源栏被拖空了 → 先把它的宽度交给邻居，再插新栏；直接 filter 会丢权重。 */
								const goneSource = without.some((pane) => pane.tabs.length === 0);
								const base = goneSource
									? removePaneGivingWeight(
											prev.panes.map((pane) =>
												pane.id === tab.paneId
													? { ...pane, tabs: pane.tabs.filter((candidate) => candidate.id !== tab.tabId) }
													: pane
											),
											tab.paneId
										)
									: normaliseWeights(without);
								const at = Math.min(index, base.length);
								const split = insertPaneWithTab(base, at, moved);
								return { panes: split.panes, focusPaneId: split.pane.id };
							});
						} else if (sessionId !== null) {
							apply((prev) => {
								const existing = findSession(prev, sessionId);
								if (existing !== void 0) return prev;
								return insertPane(prev, index, sessionId);
							});
						}
						drag.sessionId = null;
						drag.tab = null;
						setDragging(false);
					},
					/* index = 分隔线左边那一栏；startLeft/pairWeight 是按下时的快照，
					   ratio 是鼠标相对起点的总位移占比。目标权重 = startLeft + ratio，
					   所以分隔线永远跟着鼠标走（旧实现把总位移当增量累加，会越跑越远）。 */
					dividerDrag: (index, startLeft, pairWeight, ratio, spanPx) =>
						apply((prev) => {
							const left = prev.panes[index];
							const right = prev.panes[index + 1];
							if (left === void 0 || right === void 0) return prev;
							const pair = pairWeight > 0 ? pairWeight : left.weight + right.weight;
							/* 权重下限之外再按像素卡一道：保证两侧都不窄于 MIN_PANE_PX。 */
							let minW = MIN_WEIGHT;
							let maxW = pair - MIN_WEIGHT;
							if (typeof spanPx === "number" && spanPx > 0) {
								const pxFloor = MIN_PANE_PX / spanPx;
								if (pxFloor * 2 < pair) {
									minW = Math.max(minW, pxFloor);
									maxW = Math.min(maxW, pair - pxFloor);
								}
							}
							if (minW > maxW) { minW = pair / 2; maxW = pair / 2; }
							const nextLeft = Math.min(maxW, Math.max(minW, startLeft + ratio * pair));
							const panes = prev.panes.map((pane, position) => {
								if (position === index) return { ...pane, weight: nextLeft };
								if (position === index + 1) return { ...pane, weight: pair - nextLeft };
								return pane;
							});
							return { ...prev, panes };
						})
				}),
				[apply]
			);

			const children = [];
			state.panes.forEach((pane, index) => {
				if (index > 0) {
					children.push(
						h(Divider, {
							key: `divider-${pane.id}`,
							index,
							narrow,
							dragging,
							// 拖动要“绝对定位”：按下时记住左栏权重与两栏合计，
							// 之后每次 pointermove 都按「起点 + 总位移」算目标权重。
							// 以前是把「离起点的总位移」当增量反复加到当前权重上，
							// 每移动一次就把整段位移再叠一遍 —— 分隔线越跑越远，不跟手。
							startLeft: state.panes[index - 1]?.weight ?? 1,
							pairWeight: pane.weight + (state.panes[index - 1]?.weight ?? 0),
							preview: hover !== null && hover.kind === "divider" && hover.index === index,
							onHover: actions.setHover,
							onDropAt: actions.dropOnDivider,
							onResize: actions.dividerDrag
						})
					);
				}
				children.push(
					h(PaneMemo, {
						key: pane.id,
						pane,
						focused: state.focusPaneId === pane.id,
						isLast: index === state.panes.length - 1,
						paneCount: state.panes.length,
						rowMap,
						sessions,
						renderFactorySlot,
						SessionProvider,
						renderSlot,
						actions,
						dragging,
						hover: hover !== null && hover.paneId === pane.id ? hover : null,
						narrow,
						/* 状态版本号：让 React.memo 知道「会话状态变了」，
						   否则 props 全等会跳过渲染，标签圆点不更新。 */
						statusTick,
						/* 视图条配置一次性打包传入：Pane 内部据此决定
						   要不要覆盖宿主 views、以及把切换条画在顶部还是底部。
						   placement=off 时 enabled=false，Pane 完全走宿主原路。 */
						viewBar: {
							enabled: prefsSnapshot.viewBarPlacement !== "off",
							placement: prefsSnapshot.viewBarPlacement,
							hostBar: prefsSnapshot.hostBar !== false,
							state: prefsSnapshot
						}
					})
				);
			});

			return h(
				"div",
				{ className: "dsv-root", ref: rootRef, "data-narrow": narrow ? "1" : "0", "data-shell": DESKTOP_SHELL ? "desktop" : "web", "data-dragging": dragging === true ? "1" : "0", style: { "--dsv-caption-inset": `${captionInset}px`, "--dsv-host-offset": `${hostOffset}px`, "--dsv-head-h": "45px", "--dsv-line": lineColorHex(prefsSnapshot.lineColor), "--dsv-line-soft": withAlpha(lineColorHex(prefsSnapshot.lineColor), lineAlpha(prefsSnapshot.lineOpacity)), "--dsv-line-w": `${lineWidthPx(prefsSnapshot.lineWidth)}px`, "--dsv-tab-accent": "#4a8cf7" } },
				h("div", { className: "dsv-panes", "data-narrow": narrow ? "1" : "0" }, children),
				/* viewBar 配置就地构造（Pane 那份是内联在它自己的 props 里，

				   这个作用域没有同名变量 —— 直接引用会 "viewBar is not defined"）。 */

				h(StatusBar, {

					state,

					sessions,

					viewBar: {

						enabled: prefsSnapshot.viewBarPlacement !== "off",

						placement: prefsSnapshot.viewBarPlacement,

						state: prefsSnapshot

					}

				}),
				/* 感应带必须在 DOM 末尾：app-region 的区域归属按绘制顺序覆盖，放前面会被标签条的 drag 盖掉。 */
				h("div", { className: "dsv-dropband", "aria-hidden": "true" })
			);
		}

		/**
		 * A resize handle that doubles as "drop here to split into a new pane".
		 */
		function Divider(props) {
			const { index, narrow, dragging, preview, onDropAt, onResize, onHover, startLeft, pairWeight } = props;
			const [active, setActive] = react.useState(false);
			const ref = react.useRef(null);

			const onPointerDown = react.useCallback(
				(event) => {
					event.preventDefault();
					const node = ref.current;
					const root = node?.parentElement ?? null;
					if (node === null || root === null) return;
					setActive(true);
					const rootRect = root.getBoundingClientRect();
					const startX = event.clientX;
					const startY = event.clientY;
					const move = (moveEvent) => {
						const span = narrow ? rootRect.height : rootRect.width;
						if (span <= 0) return;
						const delta = narrow ? moveEvent.clientY - startY : moveEvent.clientX - startX;
						// 传“绝对目标”：起点权重 + 本次总位移占比。不是增量。
						onResize(index - 1, startLeft, pairWeight, delta / span, span);
					};
					const up = () => {
						setActive(false);
						window.removeEventListener("pointermove", move);
						window.removeEventListener("pointerup", up);
					};
					window.addEventListener("pointermove", move);
					window.addEventListener("pointerup", up);
				},
				[index, narrow, onResize, startLeft, pairWeight]
			);

			return h("div", {
				className: "dsv-divider",
				ref,
				"data-dragging": active ? "1" : "0",
				"data-drop": dragging ? "1" : "0",
				"data-preview": preview ? "1" : "0",
				role: "separator",
				"aria-orientation": narrow ? "horizontal" : "vertical",
				onPointerDown,
				onDragOver: (event) => {
					if (!dragging) return;
					event.preventDefault();
					event.stopPropagation();
					onHover?.({ index, kind: "divider" });
				},
				onDragLeave: () => {
					onHover?.(null);
				},
				onDrop: (event) => {
					event.preventDefault();
					event.stopPropagation();
					onHover?.(null);
					onDropAt(index);
				}
			});
		}

		/** React's useState without pulling it out of the require shim twice. */

		/**
		 * The sidebar row icon: two panes.
		 */
		function PanelIcon() {
			return h(
				"svg",
				{ width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
				h("rect", { x: 1.5, y: 2.5, width: 13, height: 11, rx: 2, stroke: "currentColor", strokeWidth: 1.3 }),
				h("line", { x1: 8, y1: 2.5, x2: 8, y2: 13.5, stroke: "currentColor", strokeWidth: 1.3 })
			);
		}
		//#endregion

		//#region plugin
		function isWorkspaceActive() {
			try {
				return SERVICES.layout?.panelInfo?.getSnapshot()?.activePanelId === PANEL_ID;
			} catch {
				return false;
			}
		}

		/**
		 * Original descriptors of the host methods this plugin wraps.
		 *
		 * Both wrapped methods are called by the host itself — `openSession` by the
		 * sidebar when a session row is clicked, `selectPanel` by the workspace view
		 * when it reveals a session — so the wrapper has to be removable without a
		 * trace. A restore path that deletes the property instead of putting the
		 * original back leaves the running app unable to switch sessions at all
		 * ("clicking a session does nothing"), and because the client hot reloads on
		 * every file change that damage outlives the plugin. The stash therefore
		 * lives on globalThis, keyed by service and method, so a later load can put
		 * back a method an older revision removed.
		 */
		const HOOK_STASH = (globalThis.__dshSplitViewHooks ??= Object.create(null));

		/**
		 * Wrap one host method and return an undo that restores the exact original
		 * descriptor. Returns null when the method is not there yet, so callers can
		 * retry once the service has resolved.
		 *
		 * @param options - service, method name and the wrapper body.
		 * @returns undo function, or null when nothing was hooked.
		 */
		function installMethodHook(options) {
			const { service: target, name, wrap } = options;
			if (target === void 0 || target === null) return null;
			const proto = Object.getPrototypeOf(target);
			let holder = target;
			let own = Object.getOwnPropertyDescriptor(target, name);
			if (own === void 0) {
				holder = proto;
				own = proto === null ? void 0 : Object.getOwnPropertyDescriptor(proto, name);
			}
			const key = `${target.constructor?.name ?? "service"}.${name}`;
			if (own === void 0) {
				const stashed = HOOK_STASH[key];
				if (stashed === void 0) return null;
				try {
					Object.defineProperty(holder, name, stashed);
				} catch {
					return null;
				}
				own = stashed;
			}
			if (typeof own.value !== "function") return null;
			let base = own.value;
			let original = own;
			if (base.__dshSplitViewWrapped === true && typeof base.__dshSplitViewBase === "function") {
				base = base.__dshSplitViewBase;
				original = { ...own, value: base };
			}
			HOOK_STASH[key] = original;
			const patched = function (...args) {
				return wrap(base, this, args);
			};
			patched.__dshSplitViewWrapped = true;
			patched.__dshSplitViewBase = base;
			try {
				Object.defineProperty(holder, name, {
					value: patched,
					writable: true,
					configurable: true,
					enumerable: own.enumerable
				});
			} catch (error) {
				console.warn(`[split-view] could not hook ${name}:`, error);
				return null;
			}
			return () => {
				if (holder[name] !== patched) return;
				try {
					Object.defineProperty(holder, name, original);
				} catch {
					/* leave the wrapper in place rather than breaking the host */
				}
			};
		}

		/**
		 * Route "open this session" into the workspace instead of the native panel.
		 * The host funnels every session click through `uiWorkspace.openSession`, so
		 * patching it once catches clicks, keyboard navigation and programmatic opens.
		 * The service may still be resolving when apply() runs, so this retries.
		 */
		function installOpenSessionHook(ctx) {
			return ctx.effect(() => {
				let disposed = false;
				let timer = null;
				let restore = null;

				const tryInstall = () => {
					if (disposed || restore !== null) return;
					const workspace = resolveWorkspaceService();
					if (workspace === void 0) {
						timer = setTimeout(tryInstall, 150);
						return;
					}
					restore = installMethodHook({
						service: workspace,
						name: "openSession",
						wrap: (base, self, args) => {
							const id = args[0];
							// With the workspace switched on, every session open belongs
							// to it — including opens that arrive while the settings page
							// or the native panel is showing, which used to fall through
							// to the host.
							if (prefs.state.enabled === true && typeof id === "string" && bridge.routing !== true) {
								requestOpen(id, () => base.apply(self, args));
								return void 0;
							}
							return base.apply(self, args);
						}
					});
					// A method the host removed in an earlier revision is restored from
					// the stash above; when it is genuinely absent, retry for a while so
					// a late-defined service still gets hooked.
					if (restore === null) timer = setTimeout(tryInstall, 300);
				};

				tryInstall();

				return () => {
					disposed = true;
					if (timer !== null) clearTimeout(timer);
					restore?.();
				};
			});
		}

		/**
		 * Capture the id of a session the host creates, before it switches panels.
		 *
		 * `createNamed` receives the id as a plain string; `createInWorkspace`
		 * hands back a thenable whose payload carries `sessionId` (or `id`). Both
		 * keep their original return value so the host flow is untouched.
		 */
		function installCreateHook(ctx) {
			return ctx.effect(() => {
				let disposed = false;
				let timer = null;
				const undos = [];

				const capture = (value) => {
					if (typeof value === "string") {
						rememberNewSession(value);
						return value;
					}
					if (value !== null && typeof value === "object") {
						if (typeof value.then === "function") {
							Promise.resolve(value).then(
								(settled) => capture(settled),
								() => void 0
							);
						} else {
							rememberNewSession(value.sessionId ?? value.id);
						}
					}
					return value;
				};

				/* The host passes the id it just minted as an argument too:
				   `createNamed({ workspaceId, sessionId })`, `replaceMain(sessionId, …)`. */
				const captureArgs = (args) => {
					const [first] = args;
					if (typeof first === "string") rememberNewSession(first);
					else if (first !== null && typeof first === "object") rememberNewSession(first.sessionId ?? first.id);
				};

				const hookInto = (service, name, undos, counter) => {
					const undo = installMethodHook({
						service,
						name,
						wrap: (base, self, args) => {
							captureArgs(args);
							return capture(base.apply(self, args));
						}
					});
					if (undo === null) counter.missing += 1;
					else undos.push(undo);
				};

				const tryInstall = () => {
					if (disposed) return;
					const workspace = resolveWorkspaceService();
					const sessions = resolveSessions();
					if (workspace === void 0) {
						timer = setTimeout(tryInstall, 150);
						return;
					}
					const counter = { missing: 0 };
					for (const name of ["createNamed", "createInWorkspace", "replaceMain"]) {
						hookInto(workspace, name, undos, counter);
					}
					if (sessions !== void 0) hookInto(sessions, "create", undos, counter);
					if (counter.missing > 0) timer = setTimeout(tryInstall, 300);
				};

				tryInstall();

				return () => {
					disposed = true;
					if (timer !== null) clearTimeout(timer);
					undos.forEach((undo) => undo());
				};
			});
		}

		/**
		 * Bring the workspace up as the main view once the panel is registered.
		 * The registration lands on the next slot reconciliation, so this retries
		 * briefly instead of racing it.
		 */
		function activateWorkspace(ctx) {
			return ctx.effect(() => {
				let disposed = false;
				let attempts = 0;
				let done = false;
				const tick = () => {
					if (disposed || done) return;
					// Only take over the main view when the user switched it on.
					if (prefs.state.enabled !== true) return;
					const layout = SERVICES.layout ?? service("layout");
					SERVICES.layout = layout;
					if (layout === void 0) {
						attempts += 1;
						if (attempts < 40) setTimeout(tick, 150);
						return;
					}
					try {
						/* 我们已是 `conversation` 本体（priority -1 影子），
						   所以「进工作区」= activePanelId 为 null，不需要切面板。
						   只有历史状态把它留在旧的 PANEL_ID 上时才复位。 */
						const current = layout.panelInfo?.getSnapshot?.()?.activePanelId ?? null;
						/* 启动即进工作区：设置页是临时页面，不该是启动落点。
						   panelInfo 会被恢复成上次的值，所以这里要复位。 */
						if (current === PANEL_ID) selectPanel(NATIVE_PANEL);
						/* 保险：activePanelId 指向 main 注册表里不存在的面板时，
						   main 槽会渲染成空 → 整页空白。这种情况必须复位到会话。 */
						if (current !== null && current !== void 0) {
							let exists = true;
							try {
								const slots = service("slots");
								const entries = slots?.entries?.("main") ?? [];
								exists = entries.some((entry) => entry.options !== void 0 && entry.options !== null && entry.options.key === current);
							} catch {
								exists = true;
							}
							if (exists === false) selectPanel(NATIVE_PANEL);
						}
						done = true;
						return;
					} catch {
						attempts += 1;
						if (attempts < 20) setTimeout(tick, 150);
					}
				};
				tick();
				/* panelInfo 的持久化恢复可能晚于首次 tick（实测启动会停在设置页），
				   所以过一会儿再复查一次：还在设置页就切回工作区。 */
				const recheck = setTimeout(() => {
					if (disposed || prefs.state.enabled !== true) return;
					try {
						const layout = SERVICES.layout ?? service("layout");
						if (layout === void 0) return;
						if ((layout.panelInfo?.getSnapshot?.()?.activePanelId ?? null) === PANEL_ID) selectPanel(NATIVE_PANEL);
					} catch {
						/* 忽略 */
					}
				}, 1800);
				return () => {
					disposed = true;
					clearTimeout(recheck);
				};
			});
		}

		/** 工作区（会话本体）。只在 activePanelId === null 时由宿主渲染。 */
		function WorkspaceRoot(props) {
			try {
				if (typeof window !== "undefined" && window.__dsvProps === undefined) window.__dsvProps = Object.keys(props);
			} catch {
				/* ignore */
			}
			// The host hands every slot entry a set of hook props (useSession*,
			// useWorkspaceAccess, …). The native header is one such entry, so the only
			// way to make it usable inside a pane is to hand it the same props.
			HOST_SLOT_PROPS = props;
			const p = usePrefs();
			/* 插件关掉时把主区还回宿主：这条条目只是 priority -1 的影子，
			   卸载不掉，但可以渲染空 —— 用户点「回到原生」后由
			   prefs.enabled=false 触发，此时 selectPanel(null) 已经生效，
			   宿主会渲染它自己的 conversation 条目（我们优先级低，被盖住）。
			   为了不挡住它，这里在关闭时返回 null 并主动退让。 */
			if (p.enabled !== true) return null;
			return h(WorkspaceBoundary, null, h(WorkspacePanel, props));
		}

		/** 设置页（真实面板 key=PANEL_ID）。宿主靠它给侧栏图标上选中态。 */
		function SettingsRoot(props) {
			try {
				HOST_SLOT_PROPS = props;
			} catch {
				/* ignore */
			}
			const p = usePrefs();
			return h(
				WorkspaceBoundary,
				null,
				h(SettingsPage, {
					onEnter: () => selectPanel(NATIVE_PANEL),
					onExit: () => {
						prefs.update({ enabled: false });
						selectPanel(NATIVE_PANEL);
					}
				})
			);
		}

		/**
		 * The sidebar row is rendered by the host and always calls
		 * layout.selectPanel(id), so wrap that to land on the settings page instead
		 * of jumping straight into the workspace. Our own selectPanel calls set
		 * `selfSelect` so they are not turned into a settings visit.
		 */
		function installPanelHook(ctx) {
			return ctx.effect(() => {
				let disposed = false;
				let restore = null;
				let attempts = 0;

				const tryInstall = () => {
					if (disposed || restore !== null) return;
					const layout = service("layout");
					SERVICES.layout = layout;
					if (layout === void 0) {
						attempts += 1;
						if (attempts < 40) setTimeout(tryInstall, 150);
						return;
					}
					restore = installMethodHook({
						service: layout,
						name: "selectPanel",
						wrap: (base, self, args) => {
							const wanted = args[0];
							/* 侧栏「多栏视图」入口：宿主固定调 layout.selectPanel(我们的 id)。
							 * 我们已经是 conversation 本体，这个 id 在 main 注册表里不存在，
							 * 透传会抛 "no entry for key"。
							 * 也不能简单重定向到 selectPanel(null) —— 那本来就是当前值，
							 * 点了等于什么都没发生（用户实测「点不进去」）。
							 * 正确语义：这个入口 = 多栏视图自己的设置页，点一下打开、
							 * 再点一下回工作区，每次都有可见反馈。 */
							/* 侧栏入口：正常透传给宿主 —— 现在 main 里真的有 key=PANEL_ID
							   这条（设置页），宿主会把 activePanelId 设成它，
							   侧栏图标自动获得选中态（和其他插件一样）。
							   之前重定向成 selectPanel(null) 就是因为没有这条，
							   结果点了没反应、也没有高亮。 */
							if (wanted === PANEL_ID) {
								/* ⚠️ 这里**不要**自动启用插件。
								   用户实测：「开关关着的时候，从侧边栏一点多栏视图，进到插件里
								   就默认给我打开了，我还没点开关呢。」
								   进设置页 ≠ 启用：设置页是独立注册的表项（key=PANEL_ID），
								   enabled 为 false 时也能正常显示。 */
								return base.apply(self, args);
							}
							/* 新建会话 (and Ctrl+Alt+N, and the login flow) create a session and
							   then ask for the native panel. Follow along and the workspace is
							   replaced by the single-pane view; adopt the session instead. */
							if (wanted === NATIVE_PANEL && bridge.selfSelect !== true && prefs.state.enabled === true) {
								foldNewSession(0);
								return void 0;
							}
							return base.apply(self, args);
						}
					});
					/* ⚠️ 还要拦住 `layout.panels.selectPanel`：
					   宿主自己走的是 `ctx.layout.selectPanel`（上面拦了），
					   但任何直接读 `layout.panels` 的代码路径可以绕过它，
					   把 activePanelId 设成 `"split-view"` —— 而那个 key 在 main
					   注册表里已经不存在（我们改用 key="conversation" 影子了），
					   结果就是 main 槽渲染成空、整页空白（用户实测「点两下就空白」）。
					   这里把它也接到同一个判定上。 */
					try {
						const panelsFace = layout.panels;
						if (panelsFace !== null && panelsFace !== void 0 && typeof panelsFace.selectPanel === "function") {
							const basePanelsSelect = panelsFace.selectPanel;
							panelsFace.selectPanel = function (...args) {
								/* 同上：进设置页不自动启用。 */
								return basePanelsSelect.apply(this, args);
							};
							const previousRestore = restore;
							restore = () => {
								panelsFace.selectPanel = basePanelsSelect;
								if (typeof previousRestore === "function") previousRestore();
							};
						}
					} catch (error) {
						console.warn("[split-view] 无法包装 layout.panels.selectPanel:", error);
					}
					if (restore === null) {
						attempts += 1;
						if (attempts < 40) setTimeout(tryInstall, 150);
					}
				};

				tryInstall();
				return () => {
					disposed = true;
					restore?.();
				};
			});
		}

		function apply(ctx) {
			installStyles();
			syncSettingsFlag();
			SERVICES.ctx = ctx;

			/* 把「锁定标签」作为一项贡献进宿主的**会话右键菜单**。
			   标签上右键 → 打开的就是宿主这份菜单（open 见 TabItem），所以标签右键与侧栏会话行右键
			   看到的是同一套项：置顶 / 重命名 / 分叉 / 归档 / 复制会话 ID…（全部由宿主注册表提供，
			   官方以后新增项自动出现，我们只加「锁定标签」这一条）。
			   resolve 在 React 之外被调用 → 只能通过 LIVE_STATE / LIVE_APPLY 读状态、写状态。 */
			ctx.effect(() => {
				let sub = null;
				try {
					/* Cordis 运行时依赖声明：回调里的 inner ctx 才有权访问 contextMenus。
					   顺手把服务引用存 MENUS，供标签右键直接 open 宿主菜单。 */
					sub = ctx.inject(["contextMenus"], (inner) => {
						MENUS = inner.contextMenus;
						try {
							inner.contextMenus.register({
								id: "session.dsv-tab-lock",
								target: "session",
								order: 900,
								resolve: (value) => {
									const sessionId = value !== null && value !== void 0 ? value.sessionId : void 0;
									const state = LIVE_STATE;
									if (typeof sessionId !== "string" || state === null) return [];
									const hit = findSession(state, sessionId);
									if (hit === void 0) return [];
									const locked = hit.tab.locked === true;
									return [
										{
											id: "dsv-tab-lock",
											label: locked ? "解锁标签" : "锁定标签",
											separatorBefore: true,
											run: () => {
												if (typeof LIVE_APPLY !== "function") return;
												LIVE_APPLY((prev) => toggleLockTab(prev, hit.pane.id, hit.tab.id));
											}
										}
									];
								}
							});
						} catch (error) {
							console.warn("[split-view] 注册会话菜单项失败:", error);
						}
					});
				} catch (error) {
					console.warn("[split-view] contextMenus 注入失败:", error);
				}
				return () => {
					MENUS = null;
					try {
						if (sub !== null && typeof sub.dispose === "function") sub.dispose();
					} catch {
						/* 忽略 */
					}
				};
			}, "dsh-split-view: tab lock session menu");
			SERVICES.sessions = service("sessions");
			SERVICES.layout = service("layout");
			SERVICES.uiWorkspace = service("uiWorkspace");

			installOpenSessionHook(ctx);
			installCreateHook(ctx);
			installPanelHook(ctx);

			/* 侧栏入口：受 prefs.showInSidebar 控制（默认显示）。
			   关掉后整条入口不注册，侧栏就没有这一项；设置页仍在，
			   所以不会把自己锁死。
			   prefs 变化时要重新注入/撤销，所以用订阅包一层。 */
			ctx.effect(() => {
				let dispose = null;
				const sync = () => {
					const want = prefs.state.showInSidebar !== false;
					if (want === true && dispose === null) {
						dispose = ctx.slots.inject("sidebar.panellist", () =>
							ctx.slots.register(
								{
									name: "sidebar.panellist",
									id: PANEL_ID,
									order: 55,
									label: () => PLUGIN_LABEL
								},
								PanelIcon
							)
						);
						return;
					}
					if (want === false && dispose !== null) {
						try {
							dispose();
						} catch {
							/* already gone */
						}
						dispose = null;
					}
				};
				sync();
				const unsubscribe = prefs.subscribe(sync);
				return () => {
					unsubscribe();
					if (dispose !== null) {
						try {
							dispose();
						} catch {
							/* already gone */
						}
						dispose = null;
					}
				};
			});

			// Also expose the same switch inside the host settings dialog.
			ctx.effect(() =>
				ctx.slots.inject("settings.section", () =>
					ctx.slots.register(
						{
							name: "settings.section",
							id: PANEL_ID,
							order: 60,
							label: () => PLUGIN_LABEL
						},
						SettingsSection
					)
				)
			);

			// The main panel. `main` is declared by the host root and cannot be
			// redeclared, so this entry only declares its own private child slot —
			// which is also what makes the kit hand us `SessionProvider`.
						/* 工作区 = 覆盖宿主自己的 `conversation` 条目（keyed 槽，低 priority 优先渲染）。
			 *
			 * ⚠️ 必须在 enabled 关闭时**撤销这条注册**，不能只让组件 return null。
			 *    同 key 的槽只会渲染一条 —— 我们 priority -1 那条一直在，宿主自己那条
			 *    就永远轮不到。组件返回 null = 主区域一片空白，而且底部面板因为
			 *    找不到 [data-slot="main.conversation"] 只展开一半。
			 *    （用户实测：「关掉开关之后退出了设置页，面板是空的，下面一个栏只展开一半」）
			 */
			ctx.effect(() => {
				let dispose = null;
				const sync = () => {
					const want = prefs.state.enabled === true;
					if (want && dispose === null) {
						dispose = ctx.slots.inject("main", () =>
							ctx.slots.register(
								{
									name: "main",
									/* 宿主 `main` 是 keyed 槽，同 key 用不同 priority 覆盖（低者渲染）。
									   用 -1 盖掉宿主自己的 `conversation` 条目后，
									   `layout.panelInfo.activePanelId` 恒为 `null`（= 原生会话），
									   宿主的右栏 / 底部面板 / 上下文诊断才全部处于「正常状态」。 */
									key: "conversation",
									priority: -1,
									children: {
										[PANE_SLOT]: { kind: "list", scope: "session-maybe" }
									}
								},
								WorkspaceRoot
							)
						);
					} else if (!want && dispose !== null) {
						try {
							dispose();
						} catch (error) {
							console.warn("[split-view] 撤销 main 注册失败:", error);
						}
						dispose = null;
						/* 关掉插件时把主区还给宿主（否则 activePanelId 还停在 split-view 上，
						   宿主不重渲染自己的 conversation，看起来「面板空、栏只展开一半」）。
						   **但如果用户正站在设置页上拨这个开关，必须留在设置页** ——
						   设置页是 key=PANEL_ID 的真面板，一 selectPanel(null) 就跳走了
						   （用户原话 2026-11-08：「开 关插件，都会立刻退出设置，这不对」）。
						   判断依据用 panelInfo 的当前值（真源），不用 prefs.showSettings（它是镜像）。 */
						let onSettingsPage = false;
						try {
							const layout = SERVICES.layout ?? service("layout");
							SERVICES.layout = layout;
							onSettingsPage = (layout?.panelInfo?.getSnapshot?.()?.activePanelId ?? null) === PANEL_ID;
						} catch {
							onSettingsPage = false;
						}
						if (onSettingsPage === false) selectPanel(NATIVE_PANEL);
					}
				};
				sync();
				const stop = prefs.subscribe(sync);
				return () => {
					if (typeof stop === "function") stop();
					if (dispose !== null) {
						try {
							dispose();
						} catch {
							/* 忽略 */
						}
					}
				};
			}, "dsh-split-view: main entry");

			/* 设置页注册成**真正的面板**（key = PANEL_ID）。
			 *
			 * 为什么必须这么做：侧栏那一列的选中态由宿主判定
			 *     const active = usePanelInfo((info) => info.activePanelId === id);
			 * 它只认 `activePanelId === <你的 id>`。我们工作区是「会话本体」
			 * （activePanelId 恒为 null），所以只要设置页不提一个真实面板 id，
			 * 侧栏图标就永远不会有选中态（用户实测：「多栏视图没有选中状态，
			 * 应该跟其他插件一样」）。
			 *
			 * 分工：
			 *   · activePanelId = null      → 宿主渲染 key="conversation" 的影子 → 工作区
			 *   · activePanelId = "split-view" → 宿主渲染这条 → 设置页（且侧栏高亮）
			 * 两者互斥，所以工作区时宿主那套「在会话上」的判断仍然成立。 */
			ctx.effect(() =>
				ctx.slots.inject("main", () =>
					ctx.slots.register(
						{
							name: "main",
							key: PANEL_ID
						},
						SettingsRoot
					)
				)
			);

			/* 槽位注册表变化轮询：宿主那条订阅通道不推送，只能自己比对。
			   全局一个定时器，2s 一次，只比「条目指纹」，没变就不 bump。 */
			let slotFingerprint = "";
			const pollSlots = () => {
				const parts = [];
				for (const name of WATCHED_SLOTS) {
					for (const item of readSlotEntries(name)) parts.push(name + ":" + item.key);
				}
				const next = parts.join("|");
				if (next !== slotFingerprint) {
					slotFingerprint = next;
					SLOT_REV.bump();
				}
			};
			pollSlots();
			const slotTimer = setInterval(pollSlots, 2000);
			ctx.effect(() => () => clearInterval(slotTimer), "dsh-split-view: slot registry poll");

			/* 持续保险：activePanelId 指向 main 注册表里不存在的面板时，
			   main 槽会渲染成空、整页空白（用户实测「点两下就空白」）。
			   这里订阅 panelInfo，发现这种悬空值立刻复位到会话。
			   之所以不能只放在 activateWorkspace 里：那个函数跑一次就 done 了。 */
			ctx.effect(() => {
				let disposed = false;
				const timed = null;
				const check = () => {
					if (disposed) return;
					try {
						const layout = SERVICES.layout ?? service("layout");
						SERVICES.layout = layout;
						if (layout === void 0 || layout.panelInfo === void 0) return;
						const current = layout.panelInfo.getSnapshot()?.activePanelId ?? null;
						if (current === null || current === void 0) return;
						const slots = service("slots");
						const entries = slots?.entries?.("main") ?? [];
						const exists = entries.some((entry) => entry.options !== void 0 && entry.options !== null && entry.options.key === current);
						if (exists === false) {
							console.warn("[split-view] activePanelId 指向不存在的面板，复位:", current);
							selectPanel(NATIVE_PANEL);
						}
					} catch {
						/* 忽略 */
					}
				};
				/* 用订阅而不是轮询：panelInfo 是 store，有 subscribe。 */
				let stop = null;
				try {
					const layout = SERVICES.layout ?? service("layout");
					if (layout !== void 0 && layout.panelInfo !== void 0 && typeof layout.panelInfo.subscribe === "function") {
						stop = layout.panelInfo.subscribe(() => {
							check();
							mirrorSettingsFromPanel();
						});
					}
				} catch {
					stop = null;
				}
				check();
				mirrorSettingsFromPanel();
				return () => {
					disposed = true;
					if (timed !== null) clearInterval(timed);
					if (typeof stop === "function") {
						try {
							stop();
						} catch {
							/* 忽略 */
						}
					}
				};
			}, "dsh-split-view: dangling panel guard");

			startRightbarKeepOpen();
			startSidebarMarks();
			activateWorkspace(ctx);

			try {
				window.__dsv = { ctx, services: SERVICES, bridge, drag, prefs, pendingNew, statusStore, statusSave };
			} catch {
				/* no window (non-web host) */
			}
		}

		exports.apply = apply;
		exports.inject = ["slots", "layout"];
		return module.exports;
	}
});
