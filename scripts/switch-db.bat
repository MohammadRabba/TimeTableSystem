@echo off
REM Switch the Prisma datasource provider between SQLite (local) and PostgreSQL (production/Vercel).
REM
REM Usage (PowerShell or cmd):
REM   scripts\switch-db.bat sqlite
REM   scripts\switch-db.bat postgresql
REM
REM After switching to postgresql, update DATABASE_URL in .env to your Postgres
REM connection string, then run:
REM   bun run db:push
REM   bun run scripts\seed.ts

setlocal enabledelayedexpansion

set TARGET=%~1
if "%TARGET%"=="" set TARGET=sqlite
set SCHEMA=prisma\schema.prisma

if not exist "%SCHEMA%" (
  echo [X] Schema file not found: %SCHEMA%
  exit /b 1
)

REM Detect current provider
findstr /C:"provider = \"sqlite\"" "%SCHEMA%" >nul 2>&1
if %errorlevel% equ 0 (
  set CURRENT=sqlite
) else (
  findstr /C:"provider = \"postgresql\"" "%SCHEMA%" >nul 2>&1
  if %errorlevel% equ 0 (
    set CURRENT=postgresql
  ) else (
    echo [X] Could not detect current provider in %SCHEMA%
    exit /b 1
  )
)

if "%CURRENT%"=="%TARGET%" (
  echo [OK] Already using %TARGET% — no change needed
  exit /b 0
)

if "%TARGET%"=="sqlite" goto swap
if "%TARGET%"=="postgresql" goto swap

echo Usage: %0 ^<sqlite^|postgresql^>
echo   sqlite       - Local dev ^(file-based, no setup^)
echo   postgresql   - Production ^(Vercel/Neon/Supabase - requires DATABASE_URL^)
exit /b 1

:swap
powershell -Command "(Get-Content '%SCHEMA%') -replace 'provider = \"%CURRENT%\"', 'provider = \"%TARGET%\"' | Set-Content '%SCHEMA%'"
echo [OK] Switched Prisma provider: %CURRENT% -^> %TARGET%

echo Running prisma generate...
call npx prisma generate

if "%TARGET%"=="postgresql" (
  echo.
  echo [!] Next steps:
  echo   1. Update DATABASE_URL in .env to your Postgres connection string
  echo      Get a free one from: https://neon.tech
  echo      Format: postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require
  echo   2. Run: bun run db:push
  echo   3. Run: bun run scripts\seed.ts
  echo   4. Set the same DATABASE_URL in Vercel env vars
) else (
  echo.
  echo [!] Next steps:
  echo   1. Update DATABASE_URL in .env to: file:/home/z/my-project/db/custom.db
  echo   2. Run: bun run db:push
  echo   3. Run: bun run scripts\seed.ts  ^(if DB is empty^)
)

endlocal
