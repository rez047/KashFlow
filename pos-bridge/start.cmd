@echo off
setlocal
pushd "%~dp0"
if not exist ".env" (
  echo Copy .env.example to .env and configure the printer and KashFlow site first.
  popd
  exit /b 1
)
node --env-file=.env server.mjs
popd
