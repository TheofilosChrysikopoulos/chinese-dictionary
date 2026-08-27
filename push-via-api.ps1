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
  if ($LASTEXITCODE -eq 0 -and $sha) {
    gh api "repos/$repo/contents/$f" -X PUT -f message="update $f" -f content=$b64 -f sha=$sha | Out-Null
  } else {
    gh api "repos/$repo/contents/$f" -X PUT -f message="add $f" -f content=$b64 | Out-Null
  }
  if ($LASTEXITCODE -ne 0) { throw "upload failed for $f" }
  Write-Host "  uploaded: $f"
}
Write-Host "DONE - all files uploaded"

