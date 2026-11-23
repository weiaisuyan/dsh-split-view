# dsh-multipane

Turn the **DeepSeek Harness main area** into a multi-pane tabbed workspace: up to four panes side by side, each with its own tab strip and its own composer. Drag a tab to a pane edge to split.

[中文说明](README.md) · [Changelog](#changelog) · [Install](#install)

![Two panes side by side: three tabs on the left pane, two on the right, each with its own tab strip and composer](https://raw.githubusercontent.com/weiaisuyan/dsh-split-view/main/docs/screenshots/01-overview.png)

> The images in this README are rendered from the plugin's real layout and colours — they are illustrations, not screen captures.

---

## The problem it solves

DSH shows one conversation at a time. Real work rarely looks like that: you want the plan on the left while you try it on the right, or the logs above and the code below. Every switch costs you the context you just built up.

Multi-pane puts those conversations on one screen, and keeps them **independent**: tabs, composer and the view switcher all belong to their own pane.

## What you get

| Capability | Notes |
| --- | --- |
| Up to four panes | `MAX_PANES = 4`; extra tabs stay in their pane |
| Per-pane tab strip | Drag to reorder, double-click to close (optional), right-click to lock |
| Per-pane composer | Type in a pane and it goes to that pane's conversation — no focus juggling |
| Drag to split | Drop a tab (or a sidebar session) on the **outer 20%** of a pane body to open a new pane on that side |
| Sidebar state colours | Only *focused / open / hidden* rows are tinted — **untouched rows stay exactly as the host renders them** |
| View switcher | The "Conversation / Orchestrate / Cost…" row in each pane header; top, bottom or hidden, order configurable |
| Attachment targeting | Drop a file on a pane and the attachment lands in that pane only |
| Bilingual | Follows the host language; switches instantly, no restart |
| Layout persistence | Pane widths, tabs per pane and the active tab are remembered |

## Install

### npm (recommended)

```bash
npx @deepseek-ai/dsh plugin --profile desktop add dsh-multipane
```

### Straight from GitHub

```bash
npx @deepseek-ai/dsh plugin --profile desktop add github:weiaisuyan/dsh-split-view
```

> The repository is called `dsh-split-view`, but the **npm package is `dsh-multipane`**. Install by package name.

### Restart DSH afterwards

The plugin's client bundle can hot-swap, but **manifest changes such as `exports` entries are only read when the host starts or the loader entry restarts**. If you upgraded from an older version and the plugin list still shows an English-only name, restart the host once.

### ⚠️ Do not enable together with `dsh-split-view` by luckybilly

Both plugins insert a loader entry with `id: split-view`, so the ids collide and the main area renders incorrectly. Remove one before installing the other.

### Upgrade / uninstall

```bash
# upgrade
npx @deepseek-ai/dsh plugin --profile desktop add dsh-multipane@latest

# uninstall
npx @deepseek-ai/dsh plugin --profile desktop remove dsh-multipane
```



## Using it

| Goal | How |
| --- | --- |
| Split | Drag a tab (or a sidebar session) onto the **outer 20%** of a pane body |
| Move a tab into another pane | Drag it onto the **middle** of the target pane |
| Close a tab | Double-click it (can be disabled in settings), or click its ✕ |
| Lock a pane | Right-click a tab → Lock; a locked pane cannot be dragged away and its tabs cannot be closed |
| Resize panes | Drag the divider between two panes |
| Hide the sidebar entry | Settings → Sidebar → Show entry in sidebar |

![Drag to split: dragging a tab to the outer 20% shows a dashed drop zone; release to open a new pane](https://raw.githubusercontent.com/weiaisuyan/dsh-split-view/main/docs/screenshots/02-drag-split.png)

## Settings

Available under DSH Settings, or by clicking the "Multi-pane" entry in the sidebar.

![Settings page: appearance, view switcher and sidebar groups](https://raw.githubusercontent.com/weiaisuyan/dsh-split-view/main/docs/screenshots/03-settings.png)

| Group | What you can tune |
| --- | --- |
| Appearance | Global line colour (7 presets + custom), divider width and opacity, active-tab focus line, tab hover background; each item can follow the global value or override it |
| View switcher | Position (top / bottom / hidden), order, which views to hide |
| Sidebar | Show the sidebar entry, session-row colouring switch, intensity of the focused / open / hidden tints |
| Behaviour | Double-click to close, drop-zone size |
| Data | Export settings as JSON / restore from JSON / reset to defaults |

Everything is stored in **local `localStorage` (key `dsh-split-view:prefs:v1`). Nothing is uploaded and nothing phones home.

## Language

The plugin follows the host language — no separate setting:

| Host language | Sidebar entry | Plugin list card | Settings title |
| --- | --- | --- | --- |
| 中文 | 多栏视图 | 多栏视图 (dsh-multipane) | 多栏视图 (Multi-pane) |
| English | Multi-pane | Multi-pane | 多栏视图 (Multi-pane) |

The settings title is intentionally bilingual so the plugin is recognisable in either UI language; every setting inside follows the host language and switches without a restart.

## Update check

The settings page shows the current version and offers a "Check for updates" action:

- it compares against `https://registry.npmjs.org/dsh-multipane/latest`;
- when a newer version exists, one click calls the host-side `POST /dsh-multipane/update` route, which downloads the npm tarball, extracts it, backs up the old files and rolls back on failure;
- this self-update **only runs when you click it** — no background polling. It bypasses pnpm (no lockfile rewrite, no release-age cooldown) and only appends an `|| <current version>` allowance to an existing `dsh-multipane` line in `pnpm-workspace.yaml`.

## Compatibility

- DSH `>= 0.2.1-rc.5` (desktop and web profiles)
- Client platform: `web` (the Chromium runtime inside DSH desktop)
- Four panes maximum; pane widths are stored as ratios so resizing the window does not break the layout

## Known limitations

- Splitting only triggers on the **outer 20%** of a pane body; the middle is "merge into this pane";
- Four panes is a hard cap — a fifth tab stays where it is;
- Mutually exclusive with luckybilly's `dsh-split-view` (see above);
- Disabling the plugin restores the host's session list immediately, but an already open multi-pane workspace is not collapsed automatically — use the "Conversation" item in the view switcher to return to the single-pane view.

## Feedback & support

| Channel | Good for | Where |
| --- | --- | --- |
| **GitHub Issues** (preferred) | Bugs, feature requests, usage questions — searchable and trackable | <https://github.com/weiaisuyan/dsh-split-view/issues/new/choose> |
| Email | Anything you would rather not post publicly (including security reports) | <1450719125@qq.com> |
| Marketplace page | Short description, install command, current version | <https://awesome-dsh-plugin.com/p/weiaisuyan/dsh-split-view/> |

When reporting, please include:

- **Version** — the `已是 最新版本（1.0.x，…）` line at the bottom of the settings page, or `version` in `~/.dsh/profiles/<profile>/node_modules/dsh-multipane/package.json`
- **DSH version** and OS (Windows / macOS / Linux)
- **UI language** (中文 / English) — the plugin ships two string sets, and some bugs only reproduce in one
- **Steps to reproduce**, plus any `[split-view]` error from the F12 console

## Development

The shipped JavaScript **is** the source — there is no build step:

```
lib/index.js      host side: self-update routes (GET /dsh-multipane/status, POST /dsh-multipane/update)
lib/client.js     client side: the whole workspace + settings page + sidebar marks (single file, ~9.4k lines)
locale/*.json     plugin-list card title and description, per language (meta.title / meta.description)
cordis.patch.yml  inserts the `id: split-view` loader entry
```

Restart the host to pick up changes. Before opening a PR, run the bundled consistency check:

```bash
node scripts/check-names.cjs     # package name / version / release-age allowance must agree
```

## Changelog

> 1.0.57–1.1.8 were internal iterations and were not published to npm; 1.1.9 is the first public release after 1.0.56.

### 1.1.9 (2026-11-23)

- **Fix: after disabling and re-enabling in the plugin manager, the panes did not return and the colors turned gray.** On 0.2.3 a disable stops only the Host entry; the client code is never unloaded. The Host `/dsh-multipane/status` now reads the profile `package.json` `bundles` directly (the manager removes the plugin there), and the client watches it through a `globalThis` watchdog that survives a ctx disposal. A disable clears the styles, row marks, `data-dsv-*` and `--dsv-*`; a re-enable revives in place: restores `prefs.enabled`, reinstalls the stylesheet, rewrites the color variables, and removes the stale inline `display:none` on `.dsv-root`.
- **Fix: the sidebar rail and tab underlines were gray after a re-enable.** The purge removed the `--dsv-*` variables from `<html>`, while the old code rewrote them only through a prefs subscription that died with the old context. The 700 ms global heartbeat now rewrites them whenever they are missing or the settings changed, without relying on that subscription.
- **Diagnostics**: `~/.dsh/.dsv-diag.json` now reports `build / status / panel.activePanelId / dom` (root, pane and tab rects plus computed styles); `~/.dsh/.dsv-disabled` can force one disable-cleanup pass for troubleshooting.

### 1.0.89 (2026-11-23)

- **Fix: the Session list lost its rendering as soon as the plugin manager opened.** The cause was the `html:not(:has(.dsv-root)) …` fallback added in 1.0.8x: a missing `.dsv-root` does not mean "disabled" — opening the plugin manager, the settings page or any Host panel that takes over the workspace unmounts it, leaving the marks in place while those rules stripped every style. The whole block is gone; cleanup after a disable is the liveness probe's job now.
- **A disable is now declared only after eight continuous seconds without the Host route** (it used to be two failed probes, about five seconds). Host recomposition makes the route blink; counting attempts cleared the page too eagerly.
### 1.0.88 (2026-11-23)

- **Disabling the plugin in the host's plugin manager now cleans the page immediately (no `Ctrl+R`).** On 0.2.3 a disable stops only the Host entry: the client code already injected into the page is never unloaded and receives no notification. The plugin now treats **its own Host route as the liveness signal**: `lib/index.js` registers `/dsh-multipane/status` inside `ctx.effect`, so disabling removes the route together with the plugin. The client probes it every 2.5s, requires one successful answer first (so environments without a webServer never false-positive), and after two consecutive failures deletes its injected `<style>`, the row marks, the `<html>` attributes and hides the workspace root, restoring the stock look in place. Re-enabling answers again, and the client then reloads the page once to mount the plugin cleanly (sessions and tasks live on the Host, so the reload does not interrupt them). If the Host keeps the workspace mounted after a disable, the client reloads once as well, so the stock interface comes back completely.
- **The row rail is now a slice of the Session row instead of a stripe beside it.** The breathing plate used to cover only the padding box while the rail was painted into the row's outermost 2.67px transparent border, so the two left edges disagreed and a seam showed around the rounded corners. The plate now spans the whole row (border box), and the static rail is drawn by an `::after` with the same shape plus a mask that keeps only the leading pixels: its outer edge follows the row's radius, its inner edge meets the plate, and the rail itself does not participate in the breathing animation.
### 1.0.87 (2026-11-23)

- **Fix: only one Session row remained after opening the plugin manager.** 1.0.60 replaced the hand-built Session reference with the host's **real retain handle**. The host treats that handle as "a mounted surface is using this Session" and releases it when the workspace unmounts, so the Session vanished from the sidebar. An A/B check (1.0.55 fine; 1.0.86 with the real handle off keeps both rows) confirmed it, so the shell is back. The actual fix for empty pane bodies was `facets: { conversation: true }` on retain (1.0.63), independent of the reference shape.
- Also confirmed: after disabling the plugin in the manager, no sidebar marks remain (`html:not(:has(.dsv-root))` neutralizes them when the workspace is gone).
### 1.0.64 (2026-11-23)

- **Fix: only the focused pane had a body** (covers the 1.0.61–1.0.63 investigation). The reference handed to the host's Session context was a hand-built shell and `sessions.retain()` omitted `facets: { conversation: true }`. 0.2.3 resolves bindings through `bindingSource(reference)`, so the shell produced none and the missing facet never materialized the conversation face — the subtree fell back to the host's current Session. The real retain handle is returned now, with the conversation facet; each pane binds its own Session. Verified with two panes side by side.
- **Session drag into a pane is no longer hijacked**: 0.2.3 shows a document-level "open in sidebar" drop preview over the main area. The gesture is now taken over in the window capture phase — the host never sees it (no preview) and the same coordinates are replayed to our pane, reusing the existing edge-split / add-tab logic.
- **Diagnostics are silent by default**: set `window.__dsvDiagOn = true` in the Console to enable them.
### 1.0.60 (2026-11-23)

- **Fix: only the focused pane had a body.** The reference handed to the host's Session context was a hand-built `{sessionId, binding}` shell. 0.2.3 resolves the binding through `bindingSource(reference)`, so the shell produced an empty binding and the subtree fell back to the host's *current* Session — every other pane rendered empty. The real `sessions.retain()` handle is returned now, so each pane binds its own Session.
- **Drag-in fallback**: another plugin can swallow `dragstart` during the capture phase, which made the whole drag look "external" and let the host's "open in sidebar" target take the drop. The row's Session is now recorded on pointerdown, and the window title bar is switched to no-drag at the same moment so `dragover` reaches the page.
### 1.0.59 (2026-11-23)

- **Fix: the rightmost header button toggled the wrong thing.** 1.0.58 forwarded its click to the new 0.2.3 "Session panel" switch; that was wrong — this button has always opened the **right sidebar** (the tabbed column), while the Session panel is a separate floating surface. It now calls `sidebarRight.toggleExpanded()` for state and `layout.openRightbar/closeRightbar` for the track (flattened onto `layout` in 0.2.3), both through the compatibility layer.
- **Read the state from the service** (`sidebarRight.isExpanded()`) instead of the build-hashed `.mP3x-q_rightbarCol` class.
### 1.0.58 (2026-11-23)

- **Restore the two APIs DSH 0.2.3 moved**: the host flattened the right-bar methods from `layout.panels.*` onto `layout.*` and deleted `uiWorkspace.replaceMain` (replaced by `openSession`). All six call sites went silent: the right-bar button did nothing, the focused tab stopped syncing the host's current Session, and leaving split view left the host on the old Session. A compatibility layer now speaks both generations.
- **The corner toggle forwards to the official switch**: 0.2.3's right bar is the official Session panel, whose own toggle owns state and animation. Our corner button now delegates the click instead of reimplementing the open/close logic.
- **Creation hooks cover the new entry points**: `connectWorkspace` / `startSession` are captured too, and the "retry every 300 ms while an API is missing" loop is capped at 20 attempts so a removed API no longer spins forever.
### 1.0.57 (2026-11-23)

- **Adapt to DSH 0.2.3-alpha.2 header entries**: the host now injects a full set of standard props into every slot entry. Our pane header builds props by hand, so a missing one silently removed the whole entry — four buttons disappeared in one day: the new **Session panel toggle** (three-line glyph), **schedule catalog**, **subagent breadcrumb** and **agent-preset label**. The pane header now supplies `useSessions`, `useAccess` and friends, and every entry gets a renderer for the child slots it declares (the Session panel's attention dot lives there); an undeclared child slot returns empty instead of throwing.
- **Fix the stylesheet never installing**: calling `applyLineVars()` during module evaluation hit the TDZ of the style text (`Cannot access 'CSS' before initialization`). The first call is now deferred to a microtask and `installStyles` retries once.
- Known gap (next release): focus-session sync and right-panel open/close still use 0.2.2's `uiWorkspace.replaceMain` / `layout.panels`, which 0.2.3 removed or flattened.

### 1.0.55 (2026-11-22)

- **Fix duplicate New Session rows when the sidebar button is clicked repeatedly.** The sidebar New Session entry (and Ctrl+N) goes through the host's `uiWorkspace.startSession`. The 1.0.54 guard tried to install itself once at plugin load, but that host service often becomes available later, so the guard was never installed: each click really created or reused a blank session. The plugin did not open it as a tab, but the host still made it the current session, so another "New session" row appeared in the sidebar. The guard now retries until the service is ready (every 700ms, then stops), and when a new blank is merged into the pane's existing blank tab the host's main session is switched back to that existing blank as a second line of defence.
- Behaviour is unchanged: one new session per pane; prompt-carrying creations and the "close the last tab" replacement flow still create as before.

### 1.0.54 (2026-11-19)

- **Fix "a new session open in another pane disappears from the sidebar".** DSH's session list only keeps the blank New Session row of the *current* main session; switching focus to another pane moves the host's main session, and the untouched new session in the first pane gets filtered out. Now, while a blank session is still open in any pane tab, the plugin projects it into the sidebar as an ordinary row (still titled "New session", with no timestamp or hover actions, and the right-click / double-click rename / drag interactions that native blank rows do not have stay disabled). Once it receives its first message, is closed, or the plugin is disabled, the native blank row returns. Only the display snapshot is touched — the host's session state, main selection and retention counts are left alone; the new-session page still uses its hero layout (composer centred), because the hero flag is computed from the true blank value rather than the projected row.
- **One new session per pane.** Before creating, the tab-strip "+" and the sidebar New Session entry look for an existing blank tab in the current pane and switch to it instead of creating another.
- **Fix stats showing inside every pane as well as the bottom bar.** `dsh-cost-meter` renamed its composer stats row, so the plugin's old `.cm-stat-dock` lookup stopped finding it: the row was neither docked into the status bar nor hidden in the panes. It now locates the host's stable `[data-composer-dock]` row (with the old class as a fallback), so these numbers appear only in the bottom status bar; the cost-details and context-usage buttons stay clickable.

### 1.0.51 (2026-11-11)

- **The rail's hide threshold is now a setting.** A new card in Settings → UI elements, "Hide the turn rail in narrow panes", adds a 0-600px slider (default 240px, `0` = never hide). The 240px cutoff used to be hard-coded, so a narrow pane always lost the rail and there was no way to change it.
- Changes take effect immediately without a restart, and each pane is judged on its own width (two- and three-pane layouts do not affect each other).
- Under the hood the fixed `@container (width<=240px)` rule is replaced by one generated at runtime: container queries accept literals, not CSS variables, so the threshold has to be spliced into the rule text. Only `visibility` is hidden - `display` stays `block` - so the 1.0.46 ratchet (narrow it and it never comes back) cannot return.

### 1.0.50 (2026-11-11)

- **Root cause of the missing rail in panes: a deadlock.** The host hides the rail with `display:none` whenever its container is 900px or narrower. Once hidden, the rail's internal virtual scroller measures a height of zero and renders no marks at all, and the plugin used "are there marks?" as its show switch - so the switch could never turn on and the rail could never come back. That is why two or three panes (a few hundred pixels each) were always blank, and dragging a pane past 900px suddenly made it appear. The rail is now located structurally, independent of whether marks exist.
- **Supplied the height it depends on.** The host derives the rail's height limit from two CSS variables (viewport height, composer height). While a tab was hidden it measured `0px` and wrote that, and nothing recomputed it afterwards, so the limit stayed zero. The plugin now rewrites those two variables using the host's own formula, only when they disagree, so the write is idempotent.
- The 1.0.49 fix (aim the nudge at the real scroll container) stays: it is what wakes the host's `initialized` flag, and measurements show one scroll notification is enough.

### 1.0.49 (2026-11-11)

- **Turn navigator missing in panes, step one: the automatic nudge was aimed at the wrong element.** Scroll ownership inside a pane lives on the host's `[data-conversation-scroll]`; its scroll listener returns immediately unless `event.target` is that very element, and setting `scrollTop` on a non-scrolling wrapper produces no scroll event at all. The 1.0.47 nudge targeted the list wrapper inside the tab content, so five seconds of nudging did nothing. It now targets the real scroll container and escalates: `scroll` event, then `scrollend`, then a real 1px scroll restored on the next frame, stopping as soon as the rail appears.
- **Added evidence capture**: each pane writes whether the rail appeared, the host's internal reading state (`initialized` / `followingTail`), the scroll container's size and the two CSS variables into `localStorage` under `dsv-rail-diag` (last 12 entries). It exists so the root cause can be pinned down without DevTools and does not affect the UI.

### 1.0.48 (2026-11-11)

- **Ctrl+Tab / Ctrl+Shift+Tab now cross panes.** Before, cycling only ran inside the current pane's tabs, so a pane with a single tab did nothing and the neighbouring pane was unreachable from the keyboard. All panes' tabs are now chained into one ring in left-to-right order (and in-strip order within a pane): the tab after a pane's last one is the next pane's first, the last pane wraps back to the first, and the reverse direction mirrors that. Focus follows the target tab, so you can keep typing in the pane you landed in.
- **Bigger "+" button on the tab strip.** It used to be a 20x20 box, shorter than the tabs and fiddly to hit. It now fills the strip's full height (same height as the tabs) and is 26px wide, with the tabs' hover background and 6px radius. Only this one button inside the tab strip changed; buttons on the settings page and elsewhere are untouched.

### 1.0.47 (2026-11-11)

- **Fixed the rail being absent the first time a pane opens** (it only appeared after dragging one pane very wide). The host's turn navigator sets its `initialized` flag on a real event, and that one chance is already gone when a pane first mounts; nudging the width slightly does not wake it up, only the scroll produced by a big reflow does - which is why two, three and four panes were all blank after a restart and switching the active pane did nothing. A pane now kicks itself adaptively: every 250ms it checks whether the rail is there and, if not, dispatches a synthetic `scroll` event (no scrolling, no layout change), escalating to an 8px real scroll that is immediately restored every third attempt. It stops as soon as the rail appears, capped at five seconds.

### 1.0.46 (2026-11-11)

- **Fixed the turn navigator flickering in and out, and never coming back after a resize**: 1.0.45 hid the rail below 480px with `display:none`, but the host's rail measures its own height for a virtual scroller - taking it out of layout recorded a height of 0 with nothing to recompute it when the pane grew back, so the rail stayed gone. The rail now keeps its layout at every width and is hidden only by `visibility` below 240px, which leaves the measurement valid and restores instantly.

### 1.0.45 (2026-11-11)

- **Brought the host's turn navigator back inside panes** (the column of short marks on the right of a conversation, with the "turn N" hover preview). The plugin never removed it: the host hides the rail whenever a conversation is narrower than 900px (`@container (width<=900px)`), and a two-pane layout puts each pane at roughly 650px, so the rule fires as soon as you split. The plugin now re-enables the rail inside panes only (still hidden below 480px), in CSS alone - no host DOM is touched and no React state is involved.

### 1.0.44 (2026-11-11)

- **Rolled back the 1.0.43 "single menu" attempt**: a narrow pane is back to two independent menus — the host's "More actions" and the plugin's "⋯". 1.0.43 merged the host menu into ours, which both broke it ("one row, then the menu vanished") and depended on reparenting the host's DOM node. Now each menu does its own job: the plugin's "⋯" only holds genuinely clipped buttons, the host's "⋯" uses its own native menu, and nothing is lost. All fixes up to 1.0.42 are unchanged.

### 1.0.42 (2026-11-11)

- **Fixed the session-header "More actions" menu not opening / showing only one item**: the host renders this menu as an **inline absolutely-positioned** popover inside the button's element, and the pane header's two `overflow:hidden` layers clipped it away, so clicking did nothing. Both layers are now `overflow:visible` and the header bar's `z-index` is raised to 30 so the popover can overlay the conversation; when buttons overflow they are still folded into the plugin's own "…", so panes don't bleed.

### 1.0.41 (2026-11-11)

- **Fixed the session-header menu showing only "More actions" with a dead click**: to avoid two "more" menus in the top-right row, the plugin used to hide the host's own "More actions" button inside its own "⋯" menu and forward a click to the hidden button. The host's newer menu positions itself from the anchor button's rect, which is zero while hidden, so it never opened. The host's button now stays visible and uses its own menu; the plugin's "⋯" only holds buttons that are genuinely clipped

### 1.0.40 (2026-11-11)

- **Fixed the second "Context" view showing a huge blank with a few lines at the bottom**: the previous version applied the "dock content to the bottom" rule too broadly, so views that need to fill the height and scroll on their own (trajectory / context / team) were collapsed to content height too. It is now scoped to the chat view with `:has([data-chat-flow])`, and the other views are back to normal

### 1.0.39 (2026-11-11)

- **Fixed the pulse peak looking brighter than the base even when both are set to the same value**: in the real list the row background and the pulse layer stack (15% base plus 15% pulse composites to 27.75%), while the settings preview uses a single layer — so the same number always looked brighter in the list. Pulsing rows now hand the background over to the pulse layer, making the on-screen opacity equal the configured value, matching the preview

### 1.0.37 (2026-11-11)

- **Fixed Ctrl+W dying on a second machine**: the host's Ctrl+W binding lives in a per-device file (`keybindings.json` in Electron's userData), so configuring one machine left the next one back on "close the window". The plugin now releases that binding itself on startup (via the host's `ctx.shortcuts.edit()`) and restores it when the switch is turned off or the plugin is disabled — no manual file copying on new machines

### 1.0.36 (2026-11-11)

- **Ctrl+W closes the tab, with two switches**: the settings page gains "Ctrl+W closes the tab" (master) and "Close the window on the last tab" (depends on the former; greyed out and disabled while the master is off). Pressing Ctrl+W on the last remaining tab now closes the window instead of appearing to do nothing
- **Bar thickness is now a continuous slider**: "Focused row bar thickness" and "Open-row bar thickness" were 1–8px chip buttons; they are sliders now, 0.5% steps up to 30% of the session-row width. Existing px values are converted to percentages automatically
- **Dragging a tab no longer lights up every divider**: only the divider the pointer is actually over highlights
- **New "Interaction" section in settings** explaining that motion follows the system animation setting, so the app stays still when Windows animations are off (by design)

### 1.0.35 (2026-11-10)

- **Fixed the janky pulse in the session list**: the breathing effect no longer restyles and repaints the whole row every frame; it animates the opacity of a pseudo-element instead, which the compositor handles. Same look, a fraction of the cost
- **Removed the dead "Unopened row text brightness" slider**: it stopped affecting anything once 1.0.34 dropped the dimming rules
- **Documentation rewritten**: a complete Chinese README plus a complete English one ([README.en.md](README.en.md))
- **Three UI illustrations added**: overview, drag-to-split, settings (rendered from the real layout and colours, not screen grabs)
- **New npm description**, aligned with the plugin-list description in both languages
- **New "Feedback & support"** section: issue templates, email, marketplace page
- **Author-local scripts removed from the repository**, plus scripts/check-privacy.cjs and a CI gate so personal data cannot creep back in

### 1.0.34 (2026-11-10)

- **Bilingual zh/en UI**: sidebar entry, every setting, tab strips, context menus and hints (~300 strings), following the host language with instant switching
- **Localised name in the plugin list**: added `locale/zh.json` + `locale/en.json` with a `./locale/*.json` export, so the card reads "多栏视图 (dsh-multipane)" / "Multi-pane"
- **Fixed the settings page losing its stylesheet**: the heartbeat no longer deletes the style element while the plugin is disabled, and the page no longer flashes unstyled
- **Fixed host session rows being restyled while the plugin was disabled**: row marks are cleared on disable, so untouched rows are fully restored
- **Fixed dimmed session rows**: removed three `opacity` rules that dimmed the entire row, including pinned rows and hover actions; only focused / open / hidden rows are tinted
- **Fixed drag-and-drop and the "＋" file picker breaking while disabled**: drop listeners and the composer attachment slot now mount and unmount with the master switch, and a drop with no valid target is no longer swallowed

### 1.0.33 and earlier

See [GitHub Releases](https://github.com/weiaisuyan/dsh-split-view/releases) and the commit history.

## License

[MIT](LICENSE)
