[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$node = if ($nodeCommand) {
    $nodeCommand.Source
} else {
    Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
}

if (-not (Test-Path -LiteralPath $node)) { throw "Node.js was not found." }
$env:KISSTOY_LOCAL_MCP_URL = "http://127.0.0.1:$Port/mcp"
& $node (Join-Path $PSScriptRoot "read-status.mjs")
if ($LASTEXITCODE -ne 0) { throw "Status query failed. Start the MCP server first." }
