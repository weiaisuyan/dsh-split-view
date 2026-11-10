"""清理 DeepSeek Harness 桌面端堆积的 dsh-auth-* cookie。

背景（实测 2026-11-10）：每次启动桌面端，宿主会新发一个 dsh-auth-<随机> cookie
（HttpOnly、30 天过期、约 226 字节），旧的不会自动清。Chromium 把所有同域 cookie
都塞进 Cookie 请求头；实测宿主 HTTP 服务的头上限约 16KB。

    15958 字节 → 303 正常
    16078 字节 → HTTP 431  ← App 报 "desktop welcome: Web authentication failed"，卡在 Loading plugins

≈71 个 cookie 就会撞线。每次「强制结束进程」(taskkill /F) 会漏一个。

用法：先完全退出 DeepSeek Harness，再运行本脚本，然后正常启动。
"""
import os
import sqlite3
import subprocess
import time

COOKIES = os.path.join(
    os.environ["APPDATA"], "@deepseek-ai", "dsh-desktop", "Network", "Cookies"
)
KEEP = 1  # 保留最新几个


def main():
    if not os.path.exists(COOKIES):
        print("找不到 Cookies 数据库：", COOKIES)
        return 1

    r = subprocess.run(["tasklist"], capture_output=True)
    txt = (r.stdout or b"").decode("gbk", "replace")
    if "DeepSeek Harness" in txt:
        print("DeepSeek Harness 还在运行。请先从托盘完全退出，再运行本脚本。")
        return 1

    con = sqlite3.connect(COOKIES)
    cur = con.cursor()
    before = cur.execute(
        "select count(*) from cookies where name like 'dsh-auth-%'"
    ).fetchone()[0]
    keep_names = [
        r[0]
        for r in cur.execute(
            "select name from cookies where name like 'dsh-auth-%' order by creation_utc desc limit ?",
            (KEEP,),
        ).fetchall()
    ]
    if keep_names:
        qmarks = ",".join("?" * len(keep_names))
        cur.execute(
            f"delete from cookies where name like 'dsh-auth-%' and name not in ({qmarks})",
            keep_names,
        )
    con.commit()
    after = cur.execute(
        "select count(*) from cookies where name like 'dsh-auth-%'"
    ).fetchone()[0]
    con.execute("vacuum")
    con.close()
    print(f"dsh-auth cookie: {before} -> {after}（保留最新 {KEEP} 个）")
    print("现在可以正常启动 DeepSeek Harness 了。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
