# Minimal static-file server for local preview during development. The repo
# root doubles as the GitHub Pages publish root (index.html lives here, not
# in a subfolder -- GitHub Pages' classic UI only supports repo root or
# /docs, not an arbitrary folder), so this serves $PSScriptRoot directly.
# The real app has no local backend any more -- content generation, storage,
# and everything else lives on api.barnyard.site (see README.md). This just
# serves the static frontend so you can click through the UI locally; any
# API call will go out to the real public Worker.
param(
    [string]$Root = $PSScriptRoot,
    [int]$Port = 5180
)

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $Root at http://localhost:$Port/"

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $path = $ctx.Request.Url.AbsolutePath.TrimStart('/')
    if ($path -eq '') { $path = 'index.html' }
    $full = [System.IO.Path]::GetFullPath((Join-Path $Root $path))
    $rootFull = ([System.IO.Path]::GetFullPath($Root)).TrimEnd('\') + '\'
    if ($full.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path $full -PathType Leaf)) {
        $bytes = [System.IO.File]::ReadAllBytes($full)
        $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
        $ctype = switch ($ext) {
            '.html' { 'text/html; charset=utf-8' }
            '.css' { 'text/css; charset=utf-8' }
            '.js' { 'application/javascript; charset=utf-8' }
            '.json' { 'application/json; charset=utf-8' }
            '.png' { 'image/png' }
            '.svg' { 'image/svg+xml' }
            default { 'application/octet-stream' }
        }
        $ctx.Response.ContentType = $ctype
        $ctx.Response.ContentLength64 = $bytes.Length
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
        $ctx.Response.StatusCode = 404
    }
    $ctx.Response.OutputStream.Close()
}
