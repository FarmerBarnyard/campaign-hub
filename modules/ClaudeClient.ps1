# Rough $/token estimate for claude-opus-5 pricing ($5 / $25 per million input/output tokens).
$script:PricePerMTokIn = 5.0
$script:PricePerMTokOut = 25.0

function Get-TodayUsage {
    $today = (Get-Date).ToString("yyyy-MM-dd")
    if (Test-Path $script:UsagePath) {
        try {
            $usage = Get-Content -Raw -Path $script:UsagePath | ConvertFrom-Json
            if ($usage.date -eq $today) {
                return [PSCustomObject]@{ date = $usage.date; count = [int]$usage.count; estCostUsd = [double]$usage.estCostUsd }
            }
        } catch { }
    }
    return [PSCustomObject]@{ date = $today; count = 0; estCostUsd = 0.0 }
}

function Save-Usage {
    param($Usage)
    $Usage | ConvertTo-Json | Set-Content -Path $script:UsagePath -Encoding UTF8
}

function Invoke-ClaudeDraft {
    param(
        [string]$Kind,
        [string]$Brief,
        [hashtable]$Hints,
        [string]$Tone
    )

    $usage = Get-TodayUsage
    if ($usage.count -ge $script:MaxGenerationsPerDay -or $usage.estCostUsd -ge $script:DailyCapUsd) {
        throw [System.Exception]::new("daily_cap_reached")
    }

    if ([string]::IsNullOrWhiteSpace($script:ApiKey)) {
        throw [System.Exception]::new("no_api_key_configured")
    }

    $schema = $script:TypeSchemas[$Kind]
    if (-not $schema) {
        throw [System.Exception]::new("unknown_kind")
    }

    $fieldList = if ($schema.fields.Count -gt 0) { $schema.fields -join ", " } else { "(no extra fields beyond tags)" }
    $toneText = if ($Tone) { $Tone } else { "neutral, generic high-fantasy tone" }

    $systemPrompt = @"
You are drafting a single Obsidian note for a tabletop D&D homebrew campaign world.

Output format (strict):
1. A YAML frontmatter block delimited by --- lines. It MUST include `tags:` as a list containing exactly `$($schema.tag)`. It should also include these fields where relevant to the brief (leave a field's value empty if it doesn't apply): $fieldList
2. Then the markdown body: concise, evocative prose using headers/bullets where natural. Use [[Wikilink]] syntax (double square brackets) for any named entities, places, or factions the text references, so the note is ready to cross-link in Obsidian.

Tone: $toneText

CRITICAL: Output ONLY the frontmatter and body, nothing else. Never include meta-commentary, questions back to the user, or offers to expand further -- the output is saved to disk as-is.
"@

    $userPrompt = "Kind: $($schema.label)`nBrief: $Brief"
    if ($Hints -and $Hints.Count -gt 0) {
        $hintLines = $Hints.GetEnumerator() | Where-Object { $_.Value } | ForEach-Object { "$($_.Key): $($_.Value)" }
        if ($hintLines) {
            $userPrompt += "`nHints:`n" + ($hintLines -join "`n")
        }
    }

    $payload = @{
        model      = $script:Model
        max_tokens = $script:MaxTokens
        system     = $systemPrompt
        messages   = @(@{ role = "user"; content = $userPrompt })
    } | ConvertTo-Json -Depth 10

    $headers = @{
        "x-api-key"         = $script:ApiKey
        "anthropic-version" = "2023-06-01"
        "content-type"      = "application/json"
    }

    $resp = Invoke-RestMethod -Uri "https://api.anthropic.com/v1/messages" -Method Post -Headers $headers -Body $payload

    $textBlock = $resp.content | Where-Object { $_.type -eq "text" } | Select-Object -First 1
    $text = if ($textBlock) { $textBlock.text } else { "" }

    $inTok = [double]$resp.usage.input_tokens
    $outTok = [double]$resp.usage.output_tokens
    $cost = ($inTok / 1000000.0 * $script:PricePerMTokIn) + ($outTok / 1000000.0 * $script:PricePerMTokOut)

    $usage.count += 1
    $usage.estCostUsd += $cost
    Save-Usage $usage

    $parsed = ConvertFrom-Frontmatter $text
    $ok = $parsed.frontmatter.Count -gt 0

    return [PSCustomObject]@{
        parsed      = $ok
        frontmatter = $parsed.frontmatter
        body        = $parsed.body
        raw         = $text
    }
}
