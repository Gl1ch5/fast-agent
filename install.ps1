# fa installer for Windows:
#   irm https://raw.githubusercontent.com/gl1ch5/fast-agent/HEAD/install.ps1 | iex
$repo = 'https://raw.githubusercontent.com/gl1ch5/fast-agent/HEAD'
$dir = if ($env:FA_BIN) { $env:FA_BIN } else { Join-Path $env:USERPROFILE '.fa\bin' }

function Test-Node {
  try {
    $p = ((& node -v) -replace '^v', '').Split('.')
    return ([int]$p[0] -gt 22) -or ([int]$p[0] -eq 22 -and [int]$p[1] -ge 18)
  } catch { return $false }
}

New-Item -ItemType Directory -Force $dir | Out-Null
Write-Host "> downloading fa.ts -> $dir" -ForegroundColor Cyan
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest "$repo/fa.ts" -OutFile "$dir\fa.ts" -UseBasicParsing
Set-Content "$dir\fa.cmd" '@node "%~dp0fa.ts" %*' -Encoding ASCII

if (-not (Test-Node)) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host '> installing Node.js LTS via winget' -ForegroundColor Cyan
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  } else {
    Write-Host '! fa needs Node.js 22.18 or newer: https://nodejs.org' -ForegroundColor Yellow
  }
}

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not $userPath) { $userPath = '' }
if (($userPath -split ';') -notcontains $dir) {
  [Environment]::SetEnvironmentVariable('Path', (($userPath.TrimEnd(';') + ';' + $dir).TrimStart(';')), 'User')
  Write-Host "> added $dir to PATH" -ForegroundColor Cyan
}
if (($env:Path -split ';') -notcontains $dir) { $env:Path += ";$dir" }

Write-Host '> done. run: fa' -ForegroundColor Green
