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
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
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
 * fails, so a half-written plugin can never brick the app.
 *
 * @param {string} profileDir profile directory that owns node_modules
 * @param {string} version version to install
 * @returns {Promise<{ok: boolean, message: string}>} result
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
      if (existsSync(target)) {
        cpSync(target, backup, { recursive: true });
      }
      rmSync(target, { recursive: true, force: true });
      cpSync(unpacked, target, { recursive: true });
      rmSync(staging, { recursive: true, force: true });
      rmSync(backup, { recursive: true, force: true });
      return { ok: true, message: "已安装 " + version };
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
