@echo off
chcp 65001 >nul
title 发布 dsh-split-view 到 npm
cd /d "C:\Users\weiai\.dsh\plugin-src\dsh-split-view"

echo ============================================================
echo  包名：@weiaisuyan/dsh-split-view
echo  说明：npm 上 dsh-split-view 已被别人占用（luckybilly 的同名插件），
echo        所以用 scoped 名发布，功能完全一样。
echo ============================================================
echo.

echo [1/3] 检查登录状态...
call npm whoami >nul 2>&1
if errorlevel 1 (
  echo     未登录，开始 npm 登录（会打开浏览器，登录完回到这个窗口）
  call npm login
  if errorlevel 1 goto fail
)

echo.
echo [2/3] 预览将要发布的文件...
call npm pack --dry-run
if errorlevel 1 goto fail

echo.
echo [3/3] 发布...
call npm publish --access public
if errorlevel 1 goto fail

echo.
echo ============================================================
echo  发布成功：@weiaisuyan/dsh-split-view
echo  别人安装（设置 → 添加插件 里粘贴）：
echo      @weiaisuyan/dsh-split-view
echo  或命令行：
echo      npx @deepseek-ai/dsh plugin --profile desktop add @weiaisuyan/dsh-split-view
echo ============================================================
pause
exit /b 0

:fail
echo.
echo 发布失败。常见原因：
echo   - npm 账号的用户名不是 weiaisuyan：scope 不匹配会报 403
echo     解决：打开 package.json 把 name 改成 @你的用户名/dsh-split-view
echo   - 需要 2FA：publish 时按提示输入验证码
echo   - 网络：registry 要用 https://registry.npmjs.org/
pause
exit /b 1
