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
console.log("\n  [OK] all names match, version consistent");
