# Minimal YAML-frontmatter parse/serialize, scoped to exactly what this project's
# note conventions use: scalar "Key: value" lines and simple "Key:" + "  - item"
# list blocks (mirrors the Obsidian vault's own template style). Not a general
# YAML parser.

function ConvertFrom-Frontmatter {
    param([string]$Raw)

    if ($Raw -notmatch '(?s)^---\r?\n(.*?)\r?\n---\r?\n?(.*)$') {
        return [PSCustomObject]@{ frontmatter = [ordered]@{}; body = $Raw }
    }
    $fmText = $Matches[1]
    $body = $Matches[2]

    $fm = [ordered]@{}
    $lines = $fmText -split "`r?`n"
    $currentKey = $null
    foreach ($line in $lines) {
        if ($line -match '^\s*-\s+(.*)$' -and $currentKey) {
            if (-not ($fm[$currentKey] -is [System.Collections.ArrayList])) {
                $fm[$currentKey] = [System.Collections.ArrayList]::new()
            }
            [void]$fm[$currentKey].Add($Matches[1].Trim())
            continue
        }
        if ($line -match '^([A-Za-z0-9_ ]+):\s*(.*)$') {
            $key = $Matches[1].Trim()
            $val = $Matches[2].Trim()
            $currentKey = $key
            if ($val -eq '') {
                $fm[$key] = $null
            } else {
                $fm[$key] = $val
            }
        }
    }
    return [PSCustomObject]@{ frontmatter = $fm; body = $body }
}

function ConvertTo-Frontmatter {
    param([hashtable]$Frontmatter, [string]$Body)

    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine('---')
    foreach ($key in $Frontmatter.Keys) {
        $val = $Frontmatter[$key]
        $isList = ($val -is [System.Array] -or $val -is [System.Collections.ArrayList])
        if ($isList) {
            [void]$sb.AppendLine("${key}:")
            foreach ($item in $val) {
                [void]$sb.AppendLine("  - $item")
            }
        } elseif ($null -eq $val -or $val -eq '') {
            [void]$sb.AppendLine("${key}:")
        } else {
            [void]$sb.AppendLine("${key}: $val")
        }
    }
    [void]$sb.AppendLine('---')
    [void]$sb.Append($Body)
    return $sb.ToString()
}
