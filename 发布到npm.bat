@echo off
setlocal
title 发布 dsh-split-view 到 npm
cd /d "C:\Users\weiai\.dsh\plugin-src\dsh-split-view"
set RC=0

echo ============================================================
echo  本地包名 : dsh-split-view        (必须保持，改了就激活不了插件)
echo  发布包名 : @weiaisuyansjd/dsh-split-view
echo  流程     : 临时改名 - 预览 - 发布 - 立刻改回 (失败也会改回)
echo ============================================================
echo.

echo [0/4] 检查 npm 登录状态...
call npm whoami >nul 2>&1
if errorlevel 1 (
  echo       未登录，打开浏览器登录 npm
  call npm login
  if errorlevel 1 (
    echo       登录失败
    set RC=1
    goto restore
  )
)

echo.
echo [1/4] 临时把包名切成 @weiaisuyansjd/dsh-split-view ...
node scripts\publish-name.cjs on
if errorlevel 1 (
  echo       改名失败
  set RC=1
  goto restore
)

echo.
echo [2/4] 预览要发布的文件 ...
call npm pack --dry-run
if errorlevel 1 (
  echo       预览失败
  set RC=1
  goto restore
)

echo.
echo [3/4] 发布...
echo       注意: 你的 npm 账号开了两步验证, 会要求输入 6 位验证码
echo.
set OTP=
set /p OTP=请打开验证器 App, 输入 6 位数字后回车:
if "%OTP%"=="" (
  echo.
  echo       没输入验证码, 放弃发布
  set RC=1
  goto restore
)
echo.
call npm publish --access public --otp=%OTP%
if errorlevel 1 (
  echo.
  echo       发布失败. 常见原因:
  echo         - 验证码输错或过期: 重新双击本文件再试
  echo         - 一直 403 scope 不匹配: 改 scripts\publish-name.cjs 里的 PUBLISH_NAME
  echo         - 想免验证码: 去 npm 网站生成 granular token (勾选 bypass 2FA) 写进 .npmrc
  set RC=1
  goto restore
)

echo.
echo [4/4] 恢复本地包名 dsh-split-view ...
node scripts\publish-name.cjs off
echo.
echo ============================================================
echo  发布成功: @weiaisuyansjd/dsh-split-view
echo  别人安装 (DSH 设置 - 添加插件, 粘贴下一行):
echo      @weiaisuyansjd/dsh-split-view
echo  或命令行:
echo      npx @deepseek-ai/dsh plugin --profile desktop add @weiaisuyansjd/dsh-split-view
echo ============================================================
goto end

:restore
echo.
echo 正在恢复本地包名 (保证插件还能正常加载) ...
node scripts\publish-name.cjs off

:end
echo.
echo 提示: 本地 package.json 的 name 永远是 dsh-split-view
pause
exit /b %RC%
