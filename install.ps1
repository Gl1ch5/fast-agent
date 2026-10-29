# fa installer for Windows:
#   irm https://raw.githubusercontent.com/gl1ch5/fast-agent/main/install.ps1 | iex
# another branch / tag: $env:FA_REF='branch-name'; irm .../<branch-name>/install.ps1 | iex
& {
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$ref = if ($env:FA_REF) { $env:FA_REF } else { 'main' }
$repo = "https://raw.githubusercontent.com/gl1ch5/fast-agent/$ref"
$dir = if ($env:FA_BIN) { $env:FA_BIN } else { Join-Path $env:USERPROFILE '.fa\bin' }
$prevEnc = [Console]::OutputEncoding
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# ─── look ────────────────────────────────────────────────────────────────────
function Show-Logo {
  $lines = '███████╗ █████╗ ', '██╔════╝██╔══██╗', '█████╗  ███████║', '██╔══╝  ██╔══██║', '██║     ██║  ██║', '╚═╝     ╚═╝  ╚═╝'
  $colors = 'DarkGray', 'DarkGray', 'Gray', 'Gray', 'White', 'White'
  Write-Host ''
  for ($i = 0; $i -lt $lines.Count; $i++) { Write-Host "  $($lines[$i])" -ForegroundColor $colors[$i]; Start-Sleep -Milliseconds 40 }
  Write-Host '  fast agent' -NoNewline; Write-Host ' · installer' -ForegroundColor DarkGray
  Write-Host ''
}
function Show-Row($icon, $color, $label, $value, $dim = '') {
  Write-Host "  $icon " -ForegroundColor $color -NoNewline
  Write-Host ($label.PadRight(10) + ' ') -NoNewline
  Write-Host $value -NoNewline
  if ($dim) { Write-Host " $dim" -ForegroundColor DarkGray -NoNewline }
  Write-Host ''
}
function Show-Ok($label, $value, $dim = '') { Show-Row '✓' 'Green' $label $value $dim }
function Show-Warn($label, $value, $dim = '') { Show-Row '!' 'Yellow' $label $value $dim }
function Stop-Install($label, $value) {
  Show-Row '✗' 'Red' $label $value
  try { [Console]::OutputEncoding = $prevEnc } catch {}
  throw "fa install failed: $value"
}
function Get-FaVersion($file) {
  if (-not (Test-Path $file)) { return '' }
  $m = Select-String -Path $file -Pattern "^const VERSION = '([^']+)'" | Select-Object -First 1
  if ($m) { return $m.Matches[0].Groups[1].Value } else { return '' }
}
function Test-Node {
  try {
    $p = ((& node -v) -replace '^v', '').Split('.')
    return ([int]$p[0] -gt 22) -or ([int]$p[0] -eq 22 -and [int]$p[1] -ge 18)
  } catch { return $false }
}
function Get-ShortPath($p) { if ($p.StartsWith($env:USERPROFILE)) { '~' + $p.Substring($env:USERPROFILE.Length) } else { $p } }

# ─── install ─────────────────────────────────────────────────────────────────
Show-Logo
New-Item -ItemType Directory -Force $dir | Out-Null
$old = Get-FaVersion "$dir\fa.ts"
if ($old) { Show-Row '●' 'DarkGray' 'installed' "fa $old" }

# download with a spinner
$tmp = "$dir\fa.ts.tmp"
$wc = New-Object Net.WebClient
$wc.Headers.Add('Cache-Control', 'no-cache')
$task = $wc.DownloadFileTaskAsync("$repo/fa.ts?t=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())", $tmp)
$frames = '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'
$n = 0
while (-not $task.IsCompleted) {
  Write-Host "`r  $($frames[$n % 10]) " -ForegroundColor Gray -NoNewline
  Write-Host "downloading fa ($ref)" -NoNewline
  Start-Sleep -Milliseconds 80; $n++
}
Write-Host ("`r" + (' ' * 60) + "`r") -NoNewline
if ($task.IsFaulted) {
  Remove-Item $tmp -ErrorAction SilentlyContinue
  Stop-Install 'download' "failed: $($task.Exception.InnerException.Message)"
}
$new = Get-FaVersion $tmp
if (-not $new) { Remove-Item $tmp -ErrorAction SilentlyContinue; Stop-Install 'download' 'the file does not look like fa' }
$kb = [math]::Round((Get-Item $tmp).Length / 1KB)
Move-Item $tmp "$dir\fa.ts" -Force
Show-Ok 'download' "fa $new" "· $kb KB · $ref"

Set-Content "$dir\fa.cmd" '@node "%~dp0fa.ts" %*' -Encoding ASCII
Show-Ok 'launcher' (Get-ShortPath "$dir\fa.cmd")

if (Test-Node) {
  Show-Ok 'node' (& node -v)
} elseif (Get-Command winget -ErrorAction SilentlyContinue) {
  Show-Row '…' 'Gray' 'node' 'installing Node.js LTS via winget'
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements | Out-Null
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  if (Test-Node) { Show-Ok 'node' (& node -v) '(installed)' } else { Show-Warn 'node' 'winget could not install it' '→ https://nodejs.org (22.18+)' }
} else {
  Show-Warn 'node' 'needs Node.js 22.18+' '→ https://nodejs.org'
}

$newTerm = $false
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not $userPath) { $userPath = '' }
if (($userPath -split ';') -notcontains $dir) {
  [Environment]::SetEnvironmentVariable('Path', (($userPath.TrimEnd(';') + ';' + $dir).TrimStart(';')), 'User')
  Show-Ok 'PATH' 'added for your user'
  $newTerm = $true
} else {
  Show-Ok 'PATH' 'already set'
}
if (($env:Path -split ';') -notcontains $dir) { $env:Path += ";$dir" }

# ─── summary ─────────────────────────────────────────────────────────────────
$title = if (-not $old) { "fa $new installed" }
  elseif ($old -eq $new) { "fa $new reinstalled (already latest)" }
  else {
    try { if ([version]$new -gt [version]$old) { "fa updated $old -> $new" } else { "fa $old -> $new" } }
    catch { "fa $old -> $new" }
  }
$w = 44
$bar = '─' * $w
Write-Host ''
Write-Host "  ╭$bar╮" -ForegroundColor DarkGray
Write-Host '  │ ' -ForegroundColor DarkGray -NoNewline; Write-Host $title.PadRight($w - 2) -NoNewline; Write-Host ' │' -ForegroundColor DarkGray
Write-Host '  │ ' -ForegroundColor DarkGray -NoNewline; Write-Host 'run: fa'.PadRight($w - 2) -ForegroundColor White -NoNewline; Write-Host ' │' -ForegroundColor DarkGray
Write-Host "  ╰$bar╯" -ForegroundColor DarkGray
if ($newTerm) { Write-Host '  works in this window now; other open terminals need a restart' -ForegroundColor DarkGray }
Write-Host ''
try { [Console]::OutputEncoding = $prevEnc } catch {}
}
