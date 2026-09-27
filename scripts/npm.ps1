# Use the npm bundled beside node.exe, bypassing a broken global npm shim.
$ErrorActionPreference = 'Stop'
$vouchNode = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$vouchNpm = Join-Path (Split-Path -Parent $vouchNode) 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path -LiteralPath $vouchNpm)) {
    throw 'Bundled npm was not found. Install Node.js with npm, then run npm ci.'
}
& $vouchNode $vouchNpm @args
exit $LASTEXITCODE
