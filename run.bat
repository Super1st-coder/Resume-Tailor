@echo off
setlocal
title Resume Tailor
cd /d "%~dp0"

REM ================================================================
REM  Resume Tailor - start everything with one double-click.
REM    http://<server-ip>:8000/        sign in (username = profile)
REM    http://<server-ip>:8000/admin   admin page
REM  First run installs Node.js + LibreOffice if missing, opens the
REM  firewall port, installs packages and builds. Later runs just start.
REM ================================================================

REM Port and (optional) public IP shown in the printed address.
if not defined PORT set "PORT=8000"
REM set "PUBLIC_HOST=203.0.113.10"

REM ---- Administrator rights (needed to install software and open the firewall) ----
net session >nul 2>&1
if errorlevel 1 (
  echo Asking for administrator rights...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

REM ---- Node.js ----
set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>&1
if errorlevel 1 (
  echo [1/5] Installing Node.js...
  where winget >nul 2>&1
  if not errorlevel 1 (
    winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  ) else (
    powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest 'https://nodejs.org/dist/v22.11.0/node-v22.11.0-x64.msi' -OutFile \"$env:TEMP\node-setup.msi\""
    msiexec /i "%TEMP%\node-setup.msi" /qn /norestart
  )
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
)
where node >nul 2>&1
if errorlevel 1 (
  echo [!] Node.js could not be installed. Install it from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
for /f "delims=" %%V in ('node -v') do echo [1/5] Node.js %%V

REM ---- LibreOffice (turns resumes into PDF) ----
if exist "%ProgramFiles%\LibreOffice\program\soffice.exe" (
  echo [2/5] LibreOffice found
) else (
  echo [2/5] Installing LibreOffice for PDF conversion - this can take a few minutes...
  where winget >nul 2>&1
  if not errorlevel 1 (
    winget install -e --id TheDocumentFoundation.LibreOffice --silent --accept-package-agreements --accept-source-agreements
  ) else (
    echo [!] winget is not available. Install LibreOffice from https://www.libreoffice.org/download
    echo     otherwise resumes cannot be saved as PDF. Continuing...
  )
)

REM ---- Firewall: allow the port ----
netsh advfirewall firewall show rule name="Resume Tailor (port %PORT%)" >nul 2>&1
if errorlevel 1 (
  netsh advfirewall firewall add rule name="Resume Tailor (port %PORT%)" dir=in action=allow protocol=TCP localport=%PORT% >nul
  echo [3/5] Firewall: opened TCP port %PORT%
) else (
  echo [3/5] Firewall: port %PORT% already open
)

REM ---- Packages ----
if not exist "node_modules\next" (
  echo [4/5] Installing packages...
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo [!] npm install failed.
    pause
    exit /b 1
  )
) else (
  echo [4/5] Packages installed
)

REM ---- Build (first run, or after deleting the .next folder) ----
if not exist ".next\BUILD_ID" (
  echo [5/5] Building - takes about a minute...
  call npm run build
  if errorlevel 1 (
    echo [!] Build failed.
    pause
    exit /b 1
  )
) else (
  echo [5/5] Build found
)

echo.
echo Starting Resume Tailor. Keep this window open; close it to stop the server.
echo If the cloud provider has its own firewall (AWS, Azure, ...), allow TCP %PORT% there too.
node scripts\start-all.js
pause
