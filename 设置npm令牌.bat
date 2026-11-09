@echo off
setlocal
title 写入 npm 发布令牌
cd /d "C:\Users\weiai"

echo ============================================================
echo  把一个 npm Access Token 写进 .npmrc
echo  用途: 免去每次发布时输入 6 位动态验证码
echo ============================================================
echo.
echo 先做完这两步 (浏览器里):
echo   1. 打开 https://www.npmjs.com/settings/weiaisuyansjd/tokens
echo   2. Generate New Token - 选 Granular Access Token
echo      - Permissions: Read and write
echo      - Packages: All packages
echo      - 勾上 Bypass two-factor authentication (2FA)
echo      - 生成后立刻复制 (只显示一次)
echo.
echo 复制好之后, 在下面这一行粘贴, 然后回车:
echo.

set TOKEN=
set /p TOKEN=粘贴 token:
if "%TOKEN%"=="" (
  echo.
  echo 没输入任何内容, 已取消
  pause
  exit /b 1
)

echo.
echo 备份现有 .npmrc 到 备份 目录 ...
set STAMP=%DATE:~0,4%%DATE:~5,2%%DATE:~8,2%_%TIME:~0,2%%TIME:~3,2%
set STAMP=%STAMP: =0%
if exist "C:\Users\weiai\.npmrc" (
  if not exist "C:\Users\weiai\AppData\Local\hermes\备份" mkdir "C:\Users\weiai\AppData\Local\hermes\备份"
  copy /y "C:\Users\weiai\.npmrc" "C:\Users\weiai\AppData\Local\hermes\备份\.npmrc.bak.%STAMP%" >nul
)

echo 写入新 token ...
> "C:\Users\weiai\.npmrc" echo //registry.npmjs.org/:_authToken=%TOKEN%

echo.
echo 验证登录身份 ...
call npm whoami
if errorlevel 1 (
  echo.
  echo 验证失败: token 可能复制不全或已失效, 重新生成一个再试
  echo 旧文件已备份在 备份 目录, 需要回滚把备份拷回来即可
  pause
  exit /b 1
)

echo.
echo ============================================================
echo  成功, 之后发布不再需要验证码
echo  现在可以去双击 发布到npm.bat 了
echo ============================================================
pause
exit /b 0
