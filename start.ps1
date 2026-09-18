Set-Location $PSScriptRoot
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm install
npm start
