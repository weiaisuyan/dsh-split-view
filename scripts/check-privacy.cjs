#!/usr/bin/env node
/**
 * check-privacy.cjs —— 提交前/CI 里的「个人信息泄露」闸门。
 *
 * 为什么有这个脚本：这个仓库一开始把作者本机的路径、Tailscale 内网 IP、SSH 私钥文件名
 * 和内部发版脚本一起推上了 GitHub。这类东西一旦公开就没法「撤回」——删掉只删了最新一次提交，
 * 历史里还在。与其靠记性，不如让机器每次提交前查一遍。
 *
 * 查什么（只看文本文件，二进制跳过）：
 *   1. 内网/私有 IP：10.x、172.16-31.x、192.168.x、127.x（本机回环也算）、100.64-127.x（CGNAT / Tailscale）
 *   2. 本机用户目录：C:\Users\<名字>、/home/<名字>、/Users/<名字>、AppData\Local
 *   3. SSH 相关：.ssh、id_rsa、id_ed25519、authorized_keys
 *   4. 凭据形状：npm_/gho_/ghp_/github_pat_ 开头的 token、AKIA 形状的 AWS key
 *   5. 邮箱：除白名单外一律报警（仓库里只允许作者公开的联系邮箱）
 *
 * 用法：
 *   node scripts/check-privacy.cjs            # 查全部被 git 跟踪的文件
 *   node scripts/check-privacy.cjs --staged   # 只查暂存区（适合 pre-commit hook）
 *   退出码 1 = 有命中，0 = 干净
 */
'use strict'

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const STAGED = process.argv.includes('--staged')

/** 公开仓库里允许出现的邮箱（作者本人的公开联系方式）。 */
const EMAIL_ALLOW = new Set(['1450719125@qq.com', 'weiaisuyan@users.noreply.github.com'])

const RULES = [
  {
    id: 'private-ip',
    why: '内网/本机 IP，暴露就泄露了网络拓扑',
    re: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})\b/g,
  },
  { id: 'loopback', why: '本机回环地址不该写进文档', re: /\b127\.0\.0\.1(?!:9177)\b/g },
  {
    id: 'home-path',
    why: '本机用户目录路径，暴露了机器上的用户名与目录结构',
    re: /(?:[A-Za-z]:[\\/]Users[\\/][^\\/\s"'`)]+|(?:\/home|\/Users)\/[A-Za-z0-9._-]+)/g,
    allow: (m) => /Users[\\/](tester|runner|Public|Default|username|<)/i.test(m),
  },
  { id: 'appdata', why: '本机 AppData 路径', re: /AppData[\\/](?:Local|Roaming)[\\/][^\s"'`)]*/g },
  { id: 'ssh', why: 'SSH 私钥/目录信息', re: /(?:\.ssh[\\/]|id_rsa|id_ed25519|authorized_keys)/g },
  {
    id: 'secret',
    why: '看起来像真凭据',
    re: /\b(?:npm_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/g,
  },
  {
    id: 'email',
    why: '私人邮箱（白名单外的都不该出现在公开仓库）',
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    allow: (m) => EMAIL_ALLOW.has(m.toLowerCase()) || /@users\.noreply\.github\.com$/i.test(m),
  },
]

const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.zip', '.tgz', '.pdf'])

function trackedFiles() {
  const args = STAGED
    ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR']
    : ['ls-files']
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean)
}

const problems = []
let scanned = 0

/** 本脚本自己就写着这些模式串，扫它必然全中，直接跳过。 */
const SELF = path.relative(ROOT, __filename).replace(/\\/g, '/')

for (const rel of trackedFiles()) {
  const abs = path.join(ROOT, rel)
  if (rel.replace(/\\/g, '/') === SELF) continue
  if (SKIP_EXT.has(path.extname(rel).toLowerCase())) continue
  let text
  try {
    text = fs.readFileSync(abs, 'utf8')
  } catch {
    continue
  }
  if (text.includes('\u0000')) continue // 二进制
  scanned += 1
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.length > 4000) continue // 压缩过的源码，噪声太大
    for (const rule of RULES) {
      rule.re.lastIndex = 0
      let m
      while ((m = rule.re.exec(line)) !== null) {
        if (rule.allow && rule.allow(m[0])) continue
        problems.push({ file: rel, line: i + 1, rule: rule.id, why: rule.why, hit: m[0].slice(0, 120) })
      }
    }
  }
}

if (problems.length === 0) {
  console.log(`[privacy] 干净：${scanned} 个文本文件，0 处命中`)
  process.exit(0)
}

console.error(`[privacy] 发现 ${problems.length} 处疑似个人信息：\n`)
for (const p of problems) {
  console.error(`  ${p.file}:${p.line}  [${p.rule}] ${p.why}`)
  console.error(`      → ${p.hit}`)
}
console.error('\n修法：换成占位符（<本机路径> / <你的内网 IP>），或把条目加进本脚本的白名单并说明原因。')
process.exit(1)
