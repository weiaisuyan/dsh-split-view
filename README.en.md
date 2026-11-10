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
