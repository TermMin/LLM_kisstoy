[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectRoot ".runtime"
$pidFile = Join-Path $runtimeDir "kisstoy-mcp.pid"

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$node = if ($nodeCommand) {
    $nodeCommand.Source
} else {
    Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
}

$healthOk = $false
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
    $healthOk = $health.service -in @("kisstoy-multi-device-mcp", "kisstoy-tutu2-mcp")
}
catch {}

if ($healthOk -and (Test-Path -LiteralPath $node)) {
    $env:KISSTOY_LOCAL_MCP_URL = "http://127.0.0.1:$Port/mcp"
    try {
        & $node (Join-Path $PSScriptRoot "emergency-stop.mjs")
    }
    catch {
        Write-Warning "Emergency stop request failed: $($_.Exception.Message)"
    }
}

if (Test-Path -LiteralPath $pidFile) {
    $serverPid = [int](Get-Content -LiteralPath $pidFile -Raw)
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid" -ErrorAction SilentlyContinue
    $expectedEntry = (Join-Path $projectRoot "dist\src\index.js").ToLowerInvariant()
    $actualCommand = if ($process.CommandLine) { $process.CommandLine.ToLowerInvariant() } else { "" }

    if ($process -and $actualCommand.Contains($expectedEntry)) {
        Stop-Process -Id $serverPid -Force
        Write-Host "Kisstoy MCP process stopped." -ForegroundColor Green
    }
    elseif ($process) {
        throw "Refusing to stop PID $serverPid because it is not the expected Kisstoy MCP process."
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}
elseif (-not $healthOk) {
    Write-Host "Kisstoy MCP is not running."
}

Write-Host "Safe stop sequence complete." -ForegroundColor Green
