@echo off
chcp 65001 >nul
setlocal
title 发布 dsh-split-view 到 npm
cd /d "C:\Users\weiai\.dsh\plugin-src\dsh-split-view"
set RC=0

echo ============================================================
echo  本地包名：dsh-split-view        （必须保持，改了就激活不了插件）
echo  发布包名：@weiaisuyan/dsh-split-view
echo             npm 上 dsh-split-view 已被 luckybilly 占用，只能发 scoped 包
echo  流程：临时改名 -^> 预览 -^> 发布 -^> 立刻改回（失败也会改回）
echo ============================================================
echo.

echo [0/4] 检查 npm 登录状态...
call npm whoami >nul 2>&1
if errorlevel 1 (
  echo       未登录，打开浏览器登录 npm（登录完回到这个窗口）
  call npm login
  if errorlevel 1 (
    echo       登录失败
    set RC=1
    goto restore
  )
)

echo.
echo [1/4] 临时把包名切成 @weiaisuyan/dsh-split-view ...
node scripts\publish-name.cjs on
if errorlevel 1 (
  echo       改名失败
  set RC=1
  goto restore
)

echo.
echo [2/4] 预览要发布的文件（应当只有 6 个：lib x2 + cordis.patch.yml + README + LICENSE + package.json）...
call npm pack --dry-run
if errorlevel 1 (
  echo       预览失败
  set RC=1
  goto restore
)

echo.
echo [3/4] 发布...
call npm publish --access public
if errorlevel 1 (
  echo       发布失败。若是 403 scope 不匹配：改 scriptspublish-name.cjs 里的 PUBLISH_NAME
  echo       （改成 @你的npm用户名/dsh-split-view，不要改 package.json 的 name）
  set RC=1
  goto restore
)

echo.
echo [4/4] 恢复本地包名 dsh-split-view ...
node scripts\publish-name.cjs off
echo.
echo ============================================================
echo  发布成功：@weiaisuyan/dsh-split-view
echo  别人安装（DSH 设置 -^> 添加插件，粘贴下面这行）：
echo      @weiaisuyan/dsh-split-view
echo  或命令行：
echo      npx @deepseek-ai/dsh plugin --profile desktop add @weiaisuyan/dsh-split-view
echo  市场（dshmarket）读 npm 数据，会自动收录，不用另外提交。
echo ============================================================
goto end

:restore
echo.
echo 正在恢复本地包名（保证插件还能正常加载）...
node scripts\publish-name.cjs off

:end
echo.
echo 提示：本地 package.json 的 name 永远是 dsh-split-view，别手动改成 scoped 名。
pause
exit /b %RC%
