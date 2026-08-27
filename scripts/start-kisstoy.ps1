[CmdletBinding()]
param(
    [switch]$Live,
    [ValidateRange(1, 65535)]
    [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectRoot ".runtime"
$pidFile = Join-Path $runtimeDir "kisstoy-mcp.pid"
$stdoutFile = Join-Path $runtimeDir "kisstoy-mcp.stdout.log"
$stderrFile = Join-Path $runtimeDir "kisstoy-mcp.stderr.log"
$envFile = Join-Path $projectRoot ".env"
$entryFile = Join-Path $projectRoot "dist\src\index.js"

function Find-NodeExecutable {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCommand) { return $nodeCommand.Source }

    $bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
    if (Test-Path -LiteralPath $bundledNode) { return $bundledNode }

    throw "Node.js 20+ was not found. Install Node.js or run this project from Codex Desktop."
}

function Read-RemoteUrl {
    $secure = Read-Host "Paste the Kisstoy remote-control URL" -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

if (-not (Test-Path -LiteralPath $envFile)) {
    $remoteUrl = Read-RemoteUrl
    if ([string]::IsNullOrWhiteSpace($remoteUrl)) { throw "A remote-control URL is required." }
    @(
        "KISSTOY_REMOTE_URL=`"$remoteUrl`""
        "KISSTOY_LIVE_CONTROL=false"
        "KISSTOY_MAX_INTENSITY=100"
        "KISSTOY_MAX_DURATION_MS=300000"
        "KISSTOY_ARM_TTL_SECONDS=3600"
        "KISSTOY_MAX_COMMANDS_PER_MINUTE=20"
        "MCP_HOST=127.0.0.1"
        "MCP_PORT=$Port"
        "MCP_ALLOWED_HOSTS=*.trycloudflare.com"
    ) | Set-Content -LiteralPath $envFile -Encoding UTF8
    Write-Host "Saved credentials to the git-ignored .env file."
}

if ($Live) {
    Write-Host "LIVE mode can physically actuate the device." -ForegroundColor Yellow
    $confirmation = Read-Host "Type LIVE to continue"
    if ($confirmation -cne "LIVE") {
        Write-Host "Cancelled."
        exit 2
    }
}

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

if (Test-Path -LiteralPath $pidFile) {
    $existingPid = [int](Get-Content -LiteralPath $pidFile -Raw)
    if (Get-Process -Id $existingPid -ErrorAction SilentlyContinue) {
        Write-Host "Kisstoy MCP is already running (PID $existingPid)." -ForegroundColor Green
        Write-Host "Endpoint: http://127.0.0.1:$Port/mcp"
        exit 0
    }
    Remove-Item -LiteralPath $pidFile -Force
}

$node = Find-NodeExecutable
if (-not (Test-Path -LiteralPath $entryFile)) {
    $tsc = Join-Path $projectRoot "node_modules\typescript\bin\tsc"
    if (-not (Test-Path -LiteralPath $tsc)) {
        throw "Dependencies are missing. Run 'pnpm install' once in $projectRoot."
    }
    & $node $tsc -p (Join-Path $projectRoot "tsconfig.json")
    if ($LASTEXITCODE -ne 0) { throw "TypeScript build failed." }
}

$env:KISSTOY_LIVE_CONTROL = if ($Live) { "true" } else { "false" }
$env:MCP_HOST = "127.0.0.1"
$env:MCP_PORT = "$Port"
$env:DOTENV_CONFIG_PATH = $envFile

$process = Start-Process `
    -FilePath $node `
    -ArgumentList @($entryFile) `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutFile `
    -RedirectStandardError $stderrFile `
    -PassThru

Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ASCII

$healthUrl = "http://127.0.0.1:$Port/health"
$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 200
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
        if ($health.service -eq "kisstoy-multi-device-mcp") {
            $ready = $true
            break
        }
    }
    catch {}
}

if (-not $ready) {
    if (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) {
        Stop-Process -Id $process.Id -Force
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    $details = if (Test-Path -LiteralPath $stderrFile) { Get-Content -LiteralPath $stderrFile -Tail 10 | Out-String } else { "" }
    throw "MCP server did not become ready. $details"
}

$mode = if ($Live) { "LIVE" } else { "dry-run" }
Write-Host "Kisstoy MCP started successfully in $mode mode." -ForegroundColor Green
Write-Host "Endpoint: http://127.0.0.1:$Port/mcp"
Write-Host "PID: $($process.Id)"
Write-Host "Use stop-kisstoy.cmd to stop safely."
