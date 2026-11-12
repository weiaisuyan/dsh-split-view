/**
 * Host half of dsh-split-view.
 *
 * The feature is a pure client-surface extension: it registers a `main` panel
 * that renders the existing conversation panel several times, each bound to its
 * own session. `apply` therefore has one real job beyond keeping the bundle row
 * mountable: keep this plugin installable through the plugin market on THIS
 * machine.
 *
 * pnpm refuses packages younger than the profile's minimumReleaseAge unless that
 * exact version is listed under minimumReleaseAgeExclude in
 * ~/.dsh/profiles/<profile>/pnpm-workspace.yaml. That list is per-machine and
 * per-profile, so every release used to break "update from the settings page" on
 * any machine whose list had not been edited by hand — something a user should
 * never have to do, and cannot reasonably do without a terminal.
 *
 * The host half has filesystem access, so it keeps the bookkeeping itself: on
 * load, append the running version to the existing dsh-multipane line when it is
 * missing. Nothing here may affect plugin loading, so every path is guarded.
 *
 * The same account has a second half, and skipping it is what made an update look
 * like it never happened: installing the files under node_modules does NOT touch
 * the profile's package.json or pnpm-lock.yaml, which still pin the OLD version.
 * The next `pnpm install` in that profile — installing or removing ANY other
 * plugin — then re-materialises the locked version over the fresh files, silently
 * downgrading this plugin and bringing the "new version available" prompt right
 * back (measured 2026-11-12: 1.0.51 installed, the 9:42 synapse install later,
 * directory 1.0.37 again, settings page still offering 1.0.51). So a successful
 * update now also rewrites both bookkeeping files to the new version and its
 * integrity, and writes neither when either edit cannot be proven exact.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Cordis plugin name used by the loader row. */
export const name = 'dsh-split-view';

/** No host services are required. */
export const inject = [];

/** Package name as published; also the name the market knows. */
const PKG_NAME = "dsh-multipane";

function readOwnVersion() {
  try {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "";
  } catch {
    return "";
  }
}

/**
 * Append `version` to the dsh-multipane row of one profile's pnpm-workspace.yaml.
 * The row has to be edited in place: pnpm honours only the FIRST rule per package
 * name, so appending a second line for the same name is ignored.
 *
 * @param {string} profileDir absolute path of the profile directory
 * @param {string} version version to allow
 * @returns boolean whether the file was changed
 */
function allowVersionOnThisMachine(profileDir, version) {
  const yamlPath = join(profileDir, "pnpm-workspace.yaml");
  if (!existsSync(yamlPath)) return false;
  const lines = readFileSync(yamlPath, "utf8").split(/\r?\n/);
  const index = lines.findIndex((line) => line.indexOf(PKG_NAME + "@") >= 0);
  if (index < 0) return false;
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp("(^|[\\s|])" + escaped + "(\\s|$)").test(lines[index])) return false;
  lines[index] = lines[index].trimEnd() + " || " + version;
  writeFileSync(yamlPath, lines.join("\n"), "utf8");
  return true;
}

/**
 * Escape a literal string so it can be embedded in a RegExp source.
 *
 * @param {string} text literal text
 * @returns string regex-safe text
 */
function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * npm-style sha512 integrity of a file ("sha512-" + base64 of the digest).
 *
 * pnpm stores exactly this string as the lockfile entry's integrity. A stale or
 * invented one makes the next install treat the package as tampered with, which
 * is worse than leaving the old entry alone.
 *
 * @param {string} file absolute path of the tarball
 * @returns {string} integrity string, or "" when the file cannot be read
 */
function integrityOfFile(file) {
  try {
    return "sha512-" + createHash("sha512").update(readFileSync(file)).digest("base64");
  } catch {
    return "";
  }
}

/**
 * Point the profile's dependency bookkeeping at `version`.
 *
 * Two files decide what the next `pnpm install` believes about this package:
 * package.json (the specifier the profile asks for) and pnpm-lock.yaml (the
 * specifier it expects, plus the version and integrity it will materialise). If
 * both keep naming the old version, the very next install in the profile
 * silently downgrades the files an update just wrote.
 *
 * Both files are edited as text rather than through a JSON/YAML round-trip, so
 * the user's formatting survives. Nothing is written unless both edits are known
 * to be exact: half-updated bookkeeping (new specifier, old lock entry) would
 * make pnpm reject the whole profile instead of merely rolling this one package
 * back — a much worse failure than the bug being fixed.
 *
 * @param {string} profileDir absolute path of the profile directory
 * @param {string} version version that was just installed
 * @param {string} integrity sha512 integrity of the tarball that was installed
 * @returns {{ok: boolean, changed: boolean, problems: string[]}} result
 */
function syncDependencyBookkeeping(profileDir, version, integrity) {
  const pkgPath = join(profileDir, "package.json");
  const lockPath = join(profileDir, "pnpm-lock.yaml");
  const problems = [];

  let pkgText = "";
  let lockText = "";
  try {
    if (existsSync(pkgPath)) pkgText = readFileSync(pkgPath, "utf8");
  } catch (error) {
    problems.push("读不了 package.json：" + String((error && error.message) || error));
  }
  try {
    if (existsSync(lockPath)) lockText = readFileSync(lockPath, "utf8");
  } catch (error) {
    problems.push("读不了 pnpm-lock.yaml：" + String((error && error.message) || error));
  }
  if (pkgText === "") problems.push("找不到 profile 的 package.json");
  if (lockText === "") problems.push("找不到 pnpm-lock.yaml");

  /* 依赖行本就存在的三种形状都认：dependencies、devDependencies、optional… 这里只按
     「"dsh-multipane": "<spec>"」这一处文本换掉 spec，不关心它在哪个段里。 */
  const depRe = new RegExp('("' + escapeRegex(PKG_NAME) + '"\\s*:\\s*")[^"]*(")');
  if (pkgText !== "" && !depRe.test(pkgText)) problems.push("package.json 里没有 " + PKG_NAME + " 的依赖行");
  if (problems.length > 0) return { ok: false, changed: false, problems };

  /* importer 块：specifier 与 version 成对出现，两行都要换。前导换行必须在捕获组里，
     否则替换会把上一行与这一行粘成一行 —— YAML 直接坏掉，pnpm 拒绝整个 profile。 */
  const importerRe = new RegExp("(\\n      " + escapeRegex(PKG_NAME) + ":\\n        specifier: )([^\\n]*)(\\n        version: )([^\\n]*)");
  const hit = lockText.match(importerRe);
  if (hit === null) return { ok: false, changed: false, problems: ["pnpm-lock 里没有 " + PKG_NAME + " 的 importer 块"] };
  /* version 可能带 peer 后缀（1.0.37(@deepseek-ai/dsh@…)），键名里只比裸版本号。 */
  const previous = hit[4].trim().split("(")[0];
  const changed = previous !== version;

  let nextLock = lockText;
  if (changed) {
    nextLock = nextLock.replace(importerRe, (all, head, spec, mid) => head + version + mid + version);
    /* packages 段与 snapshots 段各有一条键：  dsh-multipane@<版本>:  */
    const keyRe = new RegExp("(^|\\n)(  " + escapeRegex(PKG_NAME) + "@)" + escapeRegex(previous) + "(?=[:(])", "g");
    const keys = (nextLock.match(keyRe) || []).length;
    if (keys < 1) return { ok: false, changed: false, problems: ["pnpm-lock 里找不到 " + PKG_NAME + "@" + previous + " 的条目"] };
    nextLock = nextLock.replace(keyRe, (all, lead, prefix) => lead + prefix + version);
    if (integrity !== "") {
      const resRe = new RegExp("(\\n  " + escapeRegex(PKG_NAME) + "@" + escapeRegex(version) + ":\\n    resolution: \\{integrity: )[^}\\n]+(\\})");
      if (!resRe.test(nextLock)) return { ok: false, changed: false, problems: ["pnpm-lock 里找不到 " + version + " 的 integrity 行"] };
      nextLock = nextLock.replace(resRe, (all, head, tail) => head + integrity + tail);
    }
    const guard = lockEditProblems(lockText, nextLock, version);
    if (guard.length > 0) {
      return { ok: false, changed: false, problems: guard.map((one) => "pnpm-lock 未写入：" + one) };
    }
  }
  const nextPkg = pkgText.replace(depRe, (all, head, tail) => head + version + tail);

  try {
    if (changed) writeFileSync(lockPath, nextLock, "utf8");
    writeFileSync(pkgPath, nextPkg, "utf8");
  } catch (error) {
    try {
      if (changed) writeFileSync(lockPath, lockText, "utf8");
    } catch {
      /* 回滚失败也不抛出：调用方拿 problems 里的原因去提示用户 */
    }
    return { ok: false, changed: false, problems: ["写登记文件失败：" + String((error && error.message) || error)] };
  }
  return { ok: true, changed, problems: [] };
}

/**
 * Guard the lockfile edit: only the lines we meant to touch may differ.
 *
 * A text edit that swallows a newline still "looks" fine in the editor but makes
 * the file unparseable, and pnpm then refuses the whole profile instead of merely
 * rolling one package back. Comparing line by line makes that impossible to ship:
 * the edit is accepted only when the line count is unchanged and every changed
 * line is one of the expected shapes.
 *
 * It returns the reasons it refused (empty array = clean) rather than a bare
 * false: a silent rejection is exactly the kind of detail that is impossible to
 * support later, and the caller shows these strings to the user.
 *
 * @param {string} before lock text as read
 * @param {string} after lock text as edited
 * @param {string} version version that was installed
 * @returns {string[]} problems, empty when the edit is clean
 */
function lockEditProblems(before, after, version) {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length !== b.length) return ["行数从 " + a.length + " 变成 " + b.length];
  /* 预期最多 5 行：importer 的 specifier 与 version、packages 键、snapshots 键、
     packages 条目的 integrity。 */
  const maxChanged = 5;
  const allowed = [
    new RegExp("^        specifier: " + escapeRegex(version) + "$"),
    new RegExp("^        version: " + escapeRegex(version) + "(?:\\(.*\\))?$"),
    /* snapshots 的条目带一个空映射：  dsh-multipane@1.0.51: {} */
    new RegExp("^  " + escapeRegex(PKG_NAME) + "@" + escapeRegex(version) + "(?:\\(.*\\))?:(?:\\s*\\{\\s*\\})?$"),
    /^    resolution: \{integrity: sha512-[^}]+\}$/
  ];
  const problems = [];
  let changed = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) continue;
    changed += 1;
    if (changed > maxChanged) {
      problems.push("改了 " + changed + " 行，超过上限 " + maxChanged);
      break;
    }
    if (!allowed.some((rule) => rule.test(b[i]))) {
      problems.push("第 " + (i + 1) + " 行不在预期范围内：" + b[i].trim().slice(0, 60));
    }
  }
  if (problems.length === 0 && changed === 0) problems.push("没有产生任何改动");
  return problems;
}

/**
 * Ask the registry for the integrity of one published version.
 *
 * The lockfile entry needs the sha512 of the tarball. Guessing it (or keeping the
 * previous version's string) makes pnpm reject the package as tampered with, so
 * when this lookup fails the caller simply does not touch the bookkeeping.
 *
 * @param {string} version published version
 * @returns {Promise<string>} integrity string, or "" when unavailable
 */
async function fetchIntegrity(version) {
  try {
    if (typeof fetch !== "function") return "";
    const response = await fetch("https://registry.npmjs.org/" + PKG_NAME + "/" + version, { cache: "no-store" });
    if (response.ok !== true) return "";
    const data = await response.json();
    const value = data && data.dist && data.dist.integrity;
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

/**
 * Make the profile's bookkeeping agree with the copy that is actually installed.
 *
 * The update route writes both files, but it can only do that for updates it
 * performs itself. A copy that arrived any other way — an older self-update that
 * predates the bookkeeping sync, a restored backup, an interrupted run — leaves a
 * profile whose lockfile still names the previous version, and the next `pnpm
 * install` (installing or removing ANY other plugin) then rolls this one back.
 * That is the exact symptom users report as "I updated it, the prompt came back".
 *
 * So on load, if the installed version and the lockfile disagree, settle it. Every
 * path is guarded and the run is fire-and-forget: plugin loading never waits on
 * the network, and a failure leaves the profile exactly as it was.
 *
 * @returns {Promise<void>} resolves when the check is done
 */
async function ensureBookkeepingMatchesInstalled() {
  try {
    const version = readOwnVersion();
    if (version === "") return;
    const root = join(homedir(), ".dsh", "profiles");
    if (!existsSync(root)) return;
    for (const profile of ["desktop", "web"]) {
      try {
        const dir = join(root, profile);
        const lockPath = join(dir, "pnpm-lock.yaml");
        if (!existsSync(lockPath)) continue;
        const lock = readFileSync(lockPath, "utf8");
        const importerRe = new RegExp("\\n(      " + escapeRegex(PKG_NAME) + ":\\n        specifier: )([^\\n]*)(\\n        version: )([^\\n]*)");
        const hit = lock.match(importerRe);
        if (hit === null) continue;
        if (hit[4].trim().split("(")[0] === version) continue;
        const integrity = await fetchIntegrity(version);
        if (integrity === "") continue;
        syncDependencyBookkeeping(dir, version, integrity);
      } catch {
        /* 单个 profile 失败不影响另一个，也不影响插件加载 */
      }
    }
  } catch {
    /* 绝不因为这里失败而挡住插件加载 */
  }
}

/**
 * Try every profile that exists on this machine (desktop is what the app uses,
 * web is used by headless checks). Unknown layouts are skipped silently.
 */
function ensureMarketInstallable() {
  try {
    const version = readOwnVersion();
    if (version === "") return;
    const root = join(homedir(), ".dsh", "profiles");
    if (!existsSync(root)) return;
    for (const profile of ["desktop", "web"]) {
      try {
        allowVersionOnThisMachine(join(root, profile), version);
      } catch {
        /* 单个 profile 失败不影响另一个，也不影响插件加载 */
      }
    }
  } catch {
    /* 绝不因为这里失败而挡住插件加载 */
  }
}

/**
 * Mount the host half.
 *
 * @returns void
 */
const UPDATE_ROUTE = "/dsh-multipane/update";
const STATUS_ROUTE = "/dsh-multipane/status";

/**
 * Install one published version straight from the npm registry.
 *
 * Why not the package manager: the market path goes through pnpm, which refuses
 * releases younger than the profile's minimumReleaseAge, and the market itself
 * syncs its catalog minutes behind the registry. Downloading the published
 * tarball and unpacking it is what "update from npm" means here — no pnpm, no
 * third-party catalog, no release-age wait.
 *
 * Safety: copy the current directory aside first, and put it back if anything
 * fails, so a half-written plugin can never brick the app. A successful copy is
 * followed by syncDependencyBookkeeping, which makes the profile's package.json
 * and pnpm-lock.yaml name the same version — without that, the next install in
 * this profile rolls the directory straight back.
 *
 * @param {string} profileDir profile directory that owns node_modules
 * @param {string} version version to install
 * @returns {Promise<{ok: boolean, message: string, warn: string}>} result
 */
function installFromRegistry(profileDir, version) {
  const target = join(profileDir, "node_modules", PKG_NAME);
  const staging = join(homedir(), ".dsh", ".dsv-update-" + process.pid);
  const backup = join(homedir(), ".dsh", ".dsv-backup-" + process.pid);
  const tarball = join(staging, "pkg.tgz");
  const url = "https://registry.npmjs.org/" + PKG_NAME + "/-/" + PKG_NAME + "-" + version + ".tgz";
  const run = (file, args, options) =>
    new Promise((resolve) => {
      execFile(file, args, Object.assign({ timeout: 120000, windowsHide: true }, options || {}), (error, stdout, stderr) => {
        resolve({ ok: error === null, out: String(stdout || ""), err: String(stderr || (error && error.message) || "") });
      });
    });
  return (async () => {
    try {
      rmSync(staging, { recursive: true, force: true });
      rmSync(backup, { recursive: true, force: true });
      mkdirSync(staging, { recursive: true });
      const dl = await run("curl", ["-sSL", "--noproxy", "*", "--max-time", "110", "-o", tarball, url]);
      if (!dl.ok || !existsSync(tarball)) return { ok: false, message: "下载失败：" + dl.err.slice(0, 200) };
      /* 必须用 Windows 自带的 bsdtar：git-bash 里的 GNU tar 会把 "C:/…" 当成
         host:path 语法去连远程主机（报 "Cannot connect to C: resolve failed"）。 */
      const tarExe = existsSync("C:/Windows/System32/tar.exe") ? "C:/Windows/System32/tar.exe" : "tar";
      const un = await run(tarExe, ["-xzf", tarball, "-C", staging]);
      if (!un.ok) return { ok: false, message: "解压失败：" + un.err.slice(0, 200) };
      const unpacked = join(staging, "package");
      if (!existsSync(join(unpacked, "package.json"))) return { ok: false, message: "包里没有 package.json" };
      const got = JSON.parse(readFileSync(join(unpacked, "package.json"), "utf8")).version;
      if (got !== version) return { ok: false, message: "包内版本是 " + got + "，不是 " + version };
      /* integrity 要从解压前的 tgz 算，解压完 staging 就删了。 */
      const integrity = integrityOfFile(tarball);
      /* 新版本先铺进目标同级的临时目录：同盘才能 rename（跨盘 rename 会退化成整次复制）。
         然后「旧目录改名挪开 → 新目录改名就位」两步换掉正式目录，空窗只剩两次 syscall。
         这一步是必须的：宿主随时可能来读 client.js —— 15 个插件的 client.js 被打进同一个
         `plugins/??…` 合并请求，复制期间只要有文件读不到，整包就 failed to load，全部插件
         一起不激活。2026-11-12 11:13 那次 web boot 崩溃就是这么来的（rm 完还没复制完）。 */
      const staged = target + ".next-" + process.pid;
      const retired = target + ".old-" + process.pid;
      rmSync(staged, { recursive: true, force: true });
      rmSync(retired, { recursive: true, force: true });
      cpSync(unpacked, staged, { recursive: true });
      if (existsSync(target)) {
        cpSync(target, backup, { recursive: true });
      }
      try {
        if (existsSync(target)) renameSync(target, retired);
        renameSync(staged, target);
      } catch (error) {
        /* 换名失败：把旧目录放回原位，再如实报错，绝不留半截安装 */
        try {
          if (!existsSync(target) && existsSync(retired)) renameSync(retired, target);
        } catch {
          /* 放不回就只能靠外层从 backup 回滚 */
        }
        rmSync(staged, { recursive: true, force: true });
        return { ok: false, message: "替换目录失败：" + String((error && error.message) || error) };
      }
      rmSync(retired, { recursive: true, force: true });
      rmSync(staging, { recursive: true, force: true });
      rmSync(backup, { recursive: true, force: true });
      /* 文件就位只是前半笔账，还要让 profile 的 package.json / pnpm-lock 也指到新版本，
         否则下一次任何 pnpm 安装都会按旧 lockfile 把这个目录重铺回旧版本。 */
      try {
        allowVersionOnThisMachine(profileDir, version);
      } catch {
        /* 免查名单只影响「从插件市场更新」，不影响已经装好的文件 */
      }
      const sync = syncDependencyBookkeeping(profileDir, version, integrity);
      if (sync.ok) return { ok: true, message: "已安装 " + version, warn: "" };
      return { ok: true, message: "已安装 " + version, warn: sync.problems.join("；") };
    } catch (error) {
      try {
        if (existsSync(backup)) {
          rmSync(target, { recursive: true, force: true });
          cpSync(backup, target, { recursive: true });
        }
      } catch {
        /* 回滚失败也不抛出 */
      }
      return { ok: false, message: String((error && error.message) || error) };
    }
  })();
}

function readJsonBody(request, limit, done) {
  let body = "";
  let aborted = false;
  request.on("data", (chunk) => {
    body += chunk;
    if (body.length > limit) {
      aborted = true;
      request.destroy();
    }
  });
  request.on("end", () => {
    if (!aborted) done(body);
  });
  request.on("error", () => {
    /* 忽略 */
  });
}

export function apply(ctx) {
  try {
    ensureMarketInstallable();
  } catch {
    /* 忽略 */
  }
  /* 账本自愈：装在盘上的版本与 lockfile 说的不一致时，启动后自己对齐一次。
     不 await —— 插件加载不允许等网络。 */
  try {
    ensureBookkeepingMatchesInstalled().catch(() => {});
  } catch {
    /* 忽略 */
  }
  try {
    ctx.inject(["webServer"], (host) => {
      const profileDirOf = () => join(homedir(), ".dsh", "profiles", "desktop");
      const routes = [
        {
          kind: "exact",
          path: STATUS_ROUTE,
          handler: (request, response) => {
            response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
            response.end(JSON.stringify({ version: readOwnVersion(), profile: profileDirOf() }));
          }
        },
        {
          kind: "exact",
          path: UPDATE_ROUTE,
          handler: (request, response) => {
            if (request.method !== "POST") {
              response.writeHead(405, { allow: "POST" });
              response.end("");
              return;
            }
            readJsonBody(request, 4096, (body) => {
              let version = "";
              try {
                version = String(JSON.parse(body).version || "");
              } catch {
                /* 交给下面校验 */
              }
              if (!/^\d+\.\d+\.\d+$/.test(version)) {
                response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
                response.end(JSON.stringify({ ok: false, message: "version 参数不合法" }));
                return;
              }
              installFromRegistry(profileDirOf(), version).then((result) => {
                response.writeHead(result.ok ? 200 : 500, { "content-type": "application/json; charset=utf-8" });
                response.end(JSON.stringify(result));
              });
            });
          }
        }
      ];
      for (const route of routes) {
        try {
          host.webServer.register(route);
        } catch {
          /* 单个路由失败不影响另一个 */
        }
      }
    });
  } catch {
    /* 拿不到 webServer 就只是没有设置页内的更新入口，插件本身照常工作 */
  }
}
