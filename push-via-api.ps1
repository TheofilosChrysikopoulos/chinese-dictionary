# Uploads repo files to GitHub via the Contents REST API.
# Handles both creating new files and updating existing ones (bypasses the
# blocked github.com:443 git endpoint on this network).
# Usage: powershell -ExecutionPolicy Bypass -File push-via-api.ps1
$ErrorActionPreference = "Continue" # gh writes expected 404s to stderr; we check $LASTEXITCODE instead
$repo = "TheofilosChrysikopoulos/chinese-dictionary"

Set-Location $PSScriptRoot
$files = @(git ls-files)
Write-Host "Uploading $($files.Count) files to $repo via API..."

foreach ($f in $files) {
  $bytes = [IO.File]::ReadAllBytes((Join-Path $PSScriptRoot $f))
  $b64 = [Convert]::ToBase64String($bytes)

  # If the file already exists on GitHub, include its sha so the PUT updates it
  $sha = gh api "repos/$repo/contents/$f" --jq .sha 2>$null
  $hasSha = ($LASTEXITCODE -eq 0 -and $sha)

  # Build the JSON request body in a temp file. Large payloads (e.g. the 1 MB
  # dictionary) exceed the Windows command-line length limit when passed via
  # -f, so we always use "gh api --input <file>" instead.
  $body = @{ message = "$(if ($hasSha) {'update'} else {'add'}) $f"; content = $b64 }
  if ($hasSha) { $body.sha = $sha }
  $bodyFile = Join-Path $env:TEMP "gh-put-body.json"
  $body | ConvertTo-Json -Compress -Depth 3 | Set-Content -Path $bodyFile -Encoding ASCII

  gh api "repos/$repo/contents/$f" -X PUT -H "Content-Type: application/json" --input $bodyFile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "upload failed for $f" }
  Write-Host "  uploaded: $f"
}
Write-Host "DONE - all files uploaded"
