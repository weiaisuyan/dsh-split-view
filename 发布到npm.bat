@echo off
setlocal
title dsh-multipane - publish to npm
cd /d "C:\Users\weiai\.dsh\plugin-src\dsh-split-view"

echo ============================================================
echo  包名 : dsh-multipane   (package.json / cordis.patch / client id 三处必须一致)
echo  仓库 : https://registry.npmjs.org/   公开
echo ============================================================
echo.

echo [0/3] 检查 npm 登录状态 ...
call npm whoami >nul 2>&1
if errorlevel 1 (
  echo       未登录，进入 npm login
  call npm login
  if errorlevel 1 (
    echo       登录失败
    pause
    exit /b 1
  )
)

echo.
echo [1/3] 校验三处包名一致 ...
node scripts\check-names.cjs
if errorlevel 1 (
  echo       包名不一致，已中止
  pause
  exit /b 1
)

echo.
echo [2/3] 预览要发布的文件 ...
call npm pack --dry-run
if errorlevel 1 (
  echo       预览失败
  pause
  exit /b 1
)

echo.
echo [3/3] 发布 ...
call npm publish --access public
if errorlevel 1 (
  echo.
  echo       发布失败。若提示需要 2FA：
  echo       打开 https://www.npmjs.com/settings/weiaisuyansjd/tokens
  echo       生成 Granular token 并勾选 Bypass two-factor authentication
  echo       写进 %USERPROFILE%\.npmrc ：  //registry.npmjs.org/:_authToken=xxx
  pause
  exit /b 1
)

echo.
echo 发布完成。
pause
