param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot "config.local.json")
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Web

if (Test-Path $ConfigPath) {
    $config = Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json
} else {
    $examplePath = Join-Path $PSScriptRoot "config.example.json"
    $config = Get-Content -Raw -Path $examplePath | ConvertFrom-Json
    Write-Warning "config.local.json not found -- using config.example.json defaults. Copy it to config.local.json and add your Anthropic API key to enable AI drafting."
}

$script:CampaignsRoot = $config.campaignsRoot
$script:Port = $config.port
$script:Model = $config.model
$script:MaxTokens = $config.maxTokens
$script:DailyCapUsd = $config.dailySpendCapUsd
$script:MaxGenerationsPerDay = $config.maxGenerationsPerDay
$script:ApiKey = $config.apiKey
$script:UsagePath = Join-Path $PSScriptRoot "usage.json"
$script:WwwRoot = Join-Path $PSScriptRoot "www"

if (-not (Test-Path $script:CampaignsRoot)) {
    New-Item -ItemType Directory -Path $script:CampaignsRoot -Force | Out-Null
    Write-Host "Created campaigns root: $script:CampaignsRoot"
}

. (Join-Path $PSScriptRoot "modules\OutputFs.ps1")
. (Join-Path $PSScriptRoot "modules\Frontmatter.ps1")
. (Join-Path $PSScriptRoot "modules\TypeSchemas.ps1")
. (Join-Path $PSScriptRoot "modules\ClaudeClient.ps1")
. (Join-Path $PSScriptRoot "modules\Routes.ps1")

function Write-StaticFile {
    param($Ctx, [string]$FullPath)
    $bytes = [System.IO.File]::ReadAllBytes($FullPath)
    $ext = [System.IO.Path]::GetExtension($FullPath).ToLowerInvariant()
    $ctype = switch ($ext) {
        '.html' { 'text/html; charset=utf-8' }
        '.css' { 'text/css; charset=utf-8' }
        '.js' { 'application/javascript; charset=utf-8' }
        '.json' { 'application/json; charset=utf-8' }
        '.png' { 'image/png' }
        '.svg' { 'image/svg+xml' }
        default { 'application/octet-stream' }
    }
    $Ctx.Response.ContentType = $ctype
    $Ctx.Response.ContentLength64 = $bytes.Length
    $Ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Ctx.Response.OutputStream.Close()
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$($script:Port)/")
$listener.Start()
Write-Host "Campaign Hub running at http://localhost:$($script:Port)/"
Write-Host "Campaigns root: $script:CampaignsRoot"

while ($listener.IsListening) {
    $ctx = $null
    try {
        $ctx = $listener.GetContext()
        $method = $ctx.Request.HttpMethod
        $path = $ctx.Request.Url.AbsolutePath

        if ($path.StartsWith("/api/")) {
            try {
                Invoke-ApiRoute -Method $method -Path $path -Ctx $ctx
            } catch [System.UnauthorizedAccessException] {
                Write-JsonResponse $ctx 400 @{ error = "invalid_path" }
            } catch {
                Write-Warning "Route error: $_"
                try { Write-JsonResponse $ctx 500 @{ error = "internal_error"; message = $_.Exception.Message } } catch { }
            }
        } else {
            $relPath = $path.TrimStart('/')
            if ($relPath -eq '') { $relPath = 'index.html' }
            $full = [System.IO.Path]::GetFullPath((Join-Path $script:WwwRoot $relPath))
            $wwwRootFull = ([System.IO.Path]::GetFullPath($script:WwwRoot)).TrimEnd('\') + '\'
            if ($full.StartsWith($wwwRootFull, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path $full -PathType Leaf)) {
                Write-StaticFile $ctx $full
            } else {
                $ctx.Response.StatusCode = 404
                $ctx.Response.OutputStream.Close()
            }
        }
    } catch {
        Write-Warning "Fatal request error: $_"
        if ($ctx) { try { $ctx.Response.OutputStream.Close() } catch { } }
    }
}
