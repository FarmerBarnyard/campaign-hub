function Resolve-CampaignPath {
    param([string]$RelPath)

    if ([string]::IsNullOrWhiteSpace($RelPath)) {
        throw [System.UnauthorizedAccessException]::new("empty path")
    }
    if ($RelPath -match '\.\.' -or $RelPath -match '^[A-Za-z]:' -or $RelPath.StartsWith('\\') -or $RelPath.StartsWith('/')) {
        throw [System.UnauthorizedAccessException]::new("rejected path: $RelPath")
    }

    $normalized = $RelPath.Replace('/', '\')
    $full = [System.IO.Path]::GetFullPath((Join-Path $script:CampaignsRoot $normalized))
    $rootFull = ([System.IO.Path]::GetFullPath($script:CampaignsRoot)).TrimEnd('\') + '\'

    if (-not $full.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
        throw [System.UnauthorizedAccessException]::new("escapes campaigns root: $RelPath")
    }

    return $full
}

function Read-Utf8File {
    param([string]$FullPath)
    return [System.IO.File]::ReadAllText($FullPath, [System.Text.UTF8Encoding]::new($false))
}

function Write-Utf8File {
    param([string]$FullPath, [string]$Content)
    $dir = [System.IO.Path]::GetDirectoryName($FullPath)
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($FullPath, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Get-CampaignList {
    if (-not (Test-Path $script:CampaignsRoot)) { return @() }
    $dirs = Get-ChildItem -Path $script:CampaignsRoot -Directory -ErrorAction SilentlyContinue
    $results = @()
    foreach ($d in $dirs) {
        $mdFiles = Get-ChildItem -Path $d.FullName -Recurse -Filter *.md -File -ErrorAction SilentlyContinue
        $last = $mdFiles | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
        $results += [PSCustomObject]@{
            name         = $d.Name
            noteCount    = @($mdFiles).Count
            lastModified = if ($last) { $last.LastWriteTimeUtc.ToString("o") } else { $null }
        }
    }
    return $results
}

function Get-DirListing {
    param([string]$RelPath)
    $full = Resolve-CampaignPath $RelPath
    if (-not (Test-Path $full)) {
        return [PSCustomObject]@{ dirs = @(); files = @() }
    }
    $items = Get-ChildItem -Path $full -ErrorAction SilentlyContinue
    $dirs = @($items | Where-Object { $_.PSIsContainer } | ForEach-Object { $_.Name })
    $files = @($items | Where-Object { -not $_.PSIsContainer } | ForEach-Object {
        [PSCustomObject]@{ name = $_.Name; size = $_.Length; modified = $_.LastWriteTimeUtc.ToString("o") }
    })
    return [PSCustomObject]@{ dirs = $dirs; files = $files }
}

function Get-CampaignsRootFull {
    return ([System.IO.Path]::GetFullPath($script:CampaignsRoot)).TrimEnd('\') + '\'
}

function Find-NoteByBasename {
    param([string]$Campaign, [string]$Text)
    $campaignFull = Resolve-CampaignPath $Campaign
    if (-not (Test-Path $campaignFull)) { return $null }
    $target = ($Text -replace '\.md$', '') + '.md'
    $match = Get-ChildItem -Path $campaignFull -Recurse -Filter $target -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $match) { return $null }
    # Relative to the CAMPAIGN folder, not campaignsRoot -- callers combine
    # this with the campaign name themselves (e.g. GET /api/note?path=...).
    $campaignFullNormalized = $campaignFull.TrimEnd('\') + '\'
    $rel = $match.FullName.Substring($campaignFullNormalized.Length)
    return $rel.Replace('\', '/')
}
