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

console.log("  package.json name :", pkg.name, pkg.version);
console.log("  cordis.patch name :", ymlName);
console.log("  client.js id      :", cid);

const ok = pkg.name && pkg.name === ymlName && ymlName === cid;
if (!ok) {
  console.error("\n  [FAIL] the three names must be identical");
  process.exit(1);
}
console.log("\n  [OK] all names match");
