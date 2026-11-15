# One-time setup of the ApplyMate Word helper for Chrome (and Edge), for the current Windows user only.
# Writes: com.applymate.word.json + host.bat in this folder, and one registry key per browser under HKCU.
param([string]$ExtensionId)
$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $ExtensionId) {
  Write-Host "Open ApplyMate > Settings > 'Exact PDF with Microsoft Word' and copy the extension ID."
  $ExtensionId = (Read-Host "Paste the extension ID").Trim()
}
if ($ExtensionId -notmatch '^[a-p]{32}$') { throw "That doesn't look like an extension ID (32 letters a-p): '$ExtensionId'" }

if (-not (Test-Path "Registry::HKEY_CLASSES_ROOT\Word.Application")) { Write-Warning "Microsoft Word wasn't found. The helper needs Word to make PDFs." }

$py = $null
foreach ($cmd in @("python", "py")) {
  $c = Get-Command $cmd -ErrorAction SilentlyContinue
  if ($c) { try { & $c.Source -c "import sys; print(sys.executable)" 2>$null | ForEach-Object { $py = $_ } } catch {} }
  if ($py) { break }
}
if (-not $py) { throw "Python 3 wasn't found. Install it from python.org (tick 'Add to PATH') and run this again." }

$bat = Join-Path $dir "host.bat"
Set-Content -Path $bat -Encoding ASCII -Value "@echo off`r`n`"$py`" -u `"$dir\host.py`""

$manifestPath = Join-Path $dir "com.applymate.word.json"
$manifest = [ordered]@{
  name            = "com.applymate.word"
  description     = "ApplyMate: convert your resume to PDF with Microsoft Word"
  path            = $bat
  type            = "stdio"
  allowed_origins = @("chrome-extension://$ExtensionId/")
}
$manifest | ConvertTo-Json | Set-Content -Path $manifestPath -Encoding UTF8

foreach ($key in @("HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.applymate.word", "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.applymate.word")) {
  New-Item -Path $key -Force | Out-Null
  Set-ItemProperty -Path $key -Name "(default)" -Value $manifestPath
}
Write-Host ""
Write-Host "Done. ApplyMate can now make exact PDFs with Microsoft Word." -ForegroundColor Green
Write-Host "Go back to ApplyMate and click 'Check again' (or reopen the preview)."
