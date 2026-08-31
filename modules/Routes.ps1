function Read-RequestBody {
    param($Ctx)
    $reader = New-Object System.IO.StreamReader($Ctx.Request.InputStream, [System.Text.Encoding]::UTF8)
    $raw = $reader.ReadToEnd()
    $reader.Close()
    if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
    return $raw | ConvertFrom-Json
}

function Write-JsonResponse {
    param($Ctx, [int]$StatusCode, $Obj)
    $json = $Obj | ConvertTo-Json -Depth 12 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $Ctx.Response.StatusCode = $StatusCode
    $Ctx.Response.ContentType = "application/json; charset=utf-8"
    $Ctx.Response.ContentLength64 = $bytes.Length
    $Ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Ctx.Response.OutputStream.Close()
}

function Invoke-ApiRoute {
    param([string]$Method, [string]$Path, $Ctx)

    $query = [System.Web.HttpUtility]::ParseQueryString($Ctx.Request.Url.Query)

    if ($Method -eq "GET" -and $Path -eq "/api/health") {
        Write-JsonResponse $Ctx 200 @{ campaignsRoot = $script:CampaignsRoot; port = $script:Port; version = "0.1.0" }
        return
    }

    if ($Method -eq "GET" -and $Path -eq "/api/schema") {
        Write-JsonResponse $Ctx 200 $script:TypeSchemas
        return
    }

    if ($Method -eq "GET" -and $Path -eq "/api/campaigns") {
        Write-JsonResponse $Ctx 200 @{ campaigns = @(Get-CampaignList) }
        return
    }

    if ($Method -eq "POST" -and $Path -eq "/api/campaigns") {
        $reqBody = Read-RequestBody $Ctx
        $name = $reqBody.name
        if ([string]::IsNullOrWhiteSpace($name)) {
            Write-JsonResponse $Ctx 400 @{ error = "missing_name" }
            return
        }
        $full = Resolve-CampaignPath $name
        if (Test-Path $full) {
            Write-JsonResponse $Ctx 409 @{ error = "campaign_exists" }
            return
        }
        New-Item -ItemType Directory -Path $full -Force | Out-Null
        Write-JsonResponse $Ctx 201 @{ name = $name; created = $true }
        return
    }

    if ($Method -eq "GET" -and $Path -eq "/api/list") {
        $campaign = $query["campaign"]
        $relPath = $query["path"]
        $fullRel = if ($relPath) { "$campaign/$relPath" } else { $campaign }
        $listing = Get-DirListing $fullRel
        Write-JsonResponse $Ctx 200 $listing
        return
    }

    if ($Method -eq "GET" -and $Path -eq "/api/note") {
        $campaign = $query["campaign"]
        $relPath = $query["path"]
        $full = Resolve-CampaignPath "$campaign/$relPath"
        if (-not (Test-Path $full -PathType Leaf)) {
            Write-JsonResponse $Ctx 404 @{ error = "not_found" }
            return
        }
        $raw = Read-Utf8File $full
        $parsed = ConvertFrom-Frontmatter $raw
        Write-JsonResponse $Ctx 200 @{ frontmatter = $parsed.frontmatter; body = $parsed.body; raw = $raw }
        return
    }

    if ($Method -eq "GET" -and $Path -eq "/api/image") {
        $campaign = $query["campaign"]
        $name = $query["name"]
        $full = Resolve-CampaignPath "$campaign/Images/$name"
        if (-not (Test-Path $full -PathType Leaf)) {
            Write-JsonResponse $Ctx 404 @{ error = "not_found" }
            return
        }
        $bytes = [System.IO.File]::ReadAllBytes($full)
        $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
        $ctype = switch ($ext) { '.png' { 'image/png' } '.jpg' { 'image/jpeg' } '.jpeg' { 'image/jpeg' } default { 'application/octet-stream' } }
        $Ctx.Response.ContentType = $ctype
        $Ctx.Response.ContentLength64 = $bytes.Length
        $Ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $Ctx.Response.OutputStream.Close()
        return
    }

    if ($Method -eq "GET" -and $Path -eq "/api/resolve-link") {
        $campaign = $query["campaign"]
        $text = $query["text"]
        $found = Find-NoteByBasename $campaign $text
        if ($found) {
            Write-JsonResponse $Ctx 200 @{ found = $true; path = $found }
        } else {
            Write-JsonResponse $Ctx 200 @{ found = $false }
        }
        return
    }

    if ($Method -eq "POST" -and $Path -eq "/api/note") {
        $reqBody = Read-RequestBody $Ctx
        $campaign = $reqBody.campaign
        $relPath = $reqBody.path
        if (-not $relPath -or -not $relPath.EndsWith(".md")) {
            Write-JsonResponse $Ctx 400 @{ error = "path_must_end_md" }
            return
        }
        $full = Resolve-CampaignPath "$campaign/$relPath"
        if (Test-Path $full) {
            Write-JsonResponse $Ctx 409 @{ error = "file_exists" }
            return
        }
        $fm = @{}
        if ($reqBody.frontmatter) {
            $reqBody.frontmatter.PSObject.Properties | ForEach-Object { $fm[$_.Name] = $_.Value }
        }
        $content = ConvertTo-Frontmatter $fm $reqBody.body
        Write-Utf8File $full $content
        Write-JsonResponse $Ctx 201 @{ path = $relPath; created = $true }
        return
    }

    if ($Method -eq "POST" -and $Path -eq "/api/map/save-image") {
        $reqBody = Read-RequestBody $Ctx
        $campaign = $reqBody.campaign
        $filename = $reqBody.filename
        if (-not $filename -or -not $filename.EndsWith(".png")) {
            Write-JsonResponse $Ctx 400 @{ error = "filename_must_end_png" }
            return
        }
        $relPath = "Images/$filename"
        $full = Resolve-CampaignPath "$campaign/$relPath"
        if (Test-Path $full) {
            Write-JsonResponse $Ctx 409 @{ error = "file_exists" }
            return
        }
        $b64 = $reqBody.dataUrl -replace '^data:image/png;base64,', ''
        $bytes = [System.Convert]::FromBase64String($b64)
        $dir = [System.IO.Path]::GetDirectoryName($full)
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        [System.IO.File]::WriteAllBytes($full, $bytes)
        Write-JsonResponse $Ctx 201 @{ path = $relPath; wikilink = "![[$filename]]" }
        return
    }

    if ($Method -eq "POST" -and $Path -eq "/api/generate-draft") {
        $reqBody = Read-RequestBody $Ctx
        $hints = @{}
        if ($reqBody.hints) {
            $reqBody.hints.PSObject.Properties | ForEach-Object { $hints[$_.Name] = $_.Value }
        }
        try {
            $draft = Invoke-ClaudeDraft -Kind $reqBody.kind -Brief $reqBody.brief -Hints $hints -Tone $reqBody.tone
            Write-JsonResponse $Ctx 200 $draft
        } catch {
            $msg = $_.Exception.Message
            if ($msg -eq "daily_cap_reached") {
                Write-JsonResponse $Ctx 429 @{ error = "daily_cap_reached" }
            } elseif ($msg -eq "no_api_key_configured") {
                Write-JsonResponse $Ctx 500 @{ error = "no_api_key_configured" }
            } else {
                Write-JsonResponse $Ctx 502 @{ error = "generate_failed"; message = $msg }
            }
        }
        return
    }

    if ($Method -eq "GET" -and $Path -eq "/api/usage") {
        Write-JsonResponse $Ctx 200 (Get-TodayUsage)
        return
    }

    Write-JsonResponse $Ctx 404 @{ error = "not_found" }
}
