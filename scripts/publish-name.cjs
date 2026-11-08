#!/usr/bin/env node
/**
 * 发布前/后切换包名。
 *
 * 背景：DSH 用 package.json 的 `name` 去匹配 cordis.patch.yml 里的 `name`，
 * 一旦改成 scoped 名（@scope/pkg），插件在本地**直接不激活**（window.__dsv 为 undefined、无报错），
 * 所以本地开发名必须一直是 `dsh-split-view`。npm 上那个名字已被 luckybilly 占用，
 * 只能发 scoped 包 —— 于是发布时临时改名、发完立刻改回。
 *
 * 用法：node scripts/publish-name.js on|off
 */
const fs = require("fs");
const path = require("path");

const LOCAL_NAME = "dsh-split-view";
const PUBLISH_NAME = "@weiaisuyan/dsh-split-view";
const pkgPath = path.join(__dirname, "..", "package.json");
const bakPath = path.join(__dirname, "..", "package.json.publish-bak");

const mode = process.argv[2];

function write(json) {
  fs.writeFileSync(pkgPath, JSON.stringify(json, null, 2) + "\n");
}

if (mode === "on") {
  // 幂等：已经切过就不重复备份（否则备份里会存着 scoped 名，恢复不回去）
  const current = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  if (current.name === PUBLISH_NAME) {
    console.log("已经是发布名了，跳过：", PUBLISH_NAME);
    process.exit(0);
  }
  fs.copyFileSync(pkgPath, bakPath);
  current.name = PUBLISH_NAME;
  current.publishConfig = { access: "public" };
  write(current);
  console.log("包名 ->", PUBLISH_NAME, "（原文件已备份到 package.json.publish-bak）");
  process.exit(0);
}

if (mode === "off") {
  let json;
  if (fs.existsSync(bakPath)) {
    json = JSON.parse(fs.readFileSync(bakPath, "utf8"));
    fs.unlinkSync(bakPath);
  } else {
    json = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  }
  json.name = LOCAL_NAME;
  delete json.publishConfig;
  write(json);
  console.log("包名 ->", LOCAL_NAME, "（已恢复，可以正常被 DSH 加载）");
  process.exit(0);
}

console.log("用法：node scripts/publish-name.js on|off");
process.exit(1);
