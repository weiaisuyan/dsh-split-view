// 校验「包名三处一致」：package.json name / cordis.patch.yml name / lib/client.js 的模块 id
// DSH 按 package.json name 找 client 入口，加载后按 client.js 的 id 注册；
// 两者不一致会静默不加载（import failed / duplicate factory registration）。
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const yml = fs.readFileSync(path.join(root, "cordis.patch.yml"), "utf8");
const ymlName = (yml.match(/name:\s*'([^']+)'/) || [])[1];
const client = fs.readFileSync(path.join(root, "lib", "client.js"), "utf8");
const cid = (client.match(/__ModuleLoader__\.load\(\{\s*\r?\n\s*id:\s*"([^"]+)"/) || [])[1];
/* client.js 里硬编码的 PLUGIN_VERSION 必须与 package.json 一致：
   设置页「检查更新」拿它和 npm latest 比，漏改就会出现「已是最新」的假结论。 */
const clientVer = (client.match(/const PLUGIN_VERSION = "([^"]+)"/) || [])[1];

console.log("  package.json name :", pkg.name, pkg.version);
console.log("  cordis.patch name :", ymlName);
console.log("  client.js id      :", cid);
console.log("  client.js version :", clientVer);

const ok = pkg.name && pkg.name === ymlName && ymlName === cid;
if (!ok) {
  console.error("\n  [FAIL] the three names must be identical");
  process.exit(1);
}
if (clientVer !== pkg.version) {
  console.error(`\n  [FAIL] PLUGIN_VERSION (${clientVer}) != package.json version (${pkg.version}) — 两处必须同改`);
  process.exit(1);
}
/* ── 机制化：把本次版本写进 profile 的 pnpm-workspace.yaml ──────────────
   原因：pnpm 对新发布的版本有 minimumReleaseAge 等待期，市场装包会被拒绝
   （表现为「无法确认符合等待策略的升级版本」）。这个白名单必须含每个要装的版本，
   1.0.7~1.0.16 每一版都被漏掉过、每次都要人手动补。放在发布闸门里，发版即同步。 */
try {
  const os = require("os");
  const profileYaml = path.join(os.homedir(), ".dsh", "profiles", "desktop", "pnpm-workspace.yaml");
  if (fs.existsSync(profileYaml)) {
    let y = fs.readFileSync(profileYaml, "utf8");
    const line = y.split("\n").find((l) => l.indexOf("dsh-multipane@") >= 0);
    if (line === void 0) {
      console.log("  [warn] pnpm-workspace.yaml 里没有 dsh-multipane 的 exclude 行，市场安装可能被等待期拒绝");
    } else if (line.indexOf(" " + pkg.version) < 0 && line.indexOf("@" + pkg.version) < 0) {
      y = y.replace(line, line.trimEnd() + " || " + pkg.version);
      fs.writeFileSync(profileYaml, y, "utf8");
      console.log("  [ok] minimumReleaseAgeExclude 已补上", pkg.version);
    } else {
      console.log("  [ok] minimumReleaseAgeExclude 已含", pkg.version);
    }
  } else {
    console.log("  [warn] 未找到 profile 的 pnpm-workspace.yaml，跳过等待期白名单维护");
  }
} catch (error) {
  console.log("  [warn] 维护 pnpm-workspace.yaml 失败：", error && error.message);
}

console.log("\n  [OK] all names match, version consistent");
