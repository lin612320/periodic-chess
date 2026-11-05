# ============================================================
# make-deploy.ps1 - build the Cloudflare Pages artifact
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/make-deploy.ps1
#
# Pure ASCII on purpose: Windows PowerShell 5.1 reads .ps1 as GBK by
# default, and non-ASCII comments/strings blow up the parser.
# ============================================================
$ErrorActionPreference = 'Stop'

$ROOT   = Split-Path -Parent $PSScriptRoot
$DEST   = Join-Path $ROOT 'deploy'
$STYLES = Join-Path $ROOT 'styles'
$JS     = Join-Path $ROOT 'js'
$AUDIO  = Join-Path $ROOT 'audio'

Write-Host '=== 1. clean deploy (keep site config) ==='
New-Item -ItemType Directory -Force -Path $DEST | Out-Null
$keep = @('README.md', '_headers', '404.html', 'robots.txt')
Get-ChildItem $DEST -Force | Where-Object { $keep -notcontains $_.Name } | Remove-Item -Recurse -Force

Write-Host '=== 2. copy entry + assets ==='
Copy-Item (Join-Path $ROOT 'index.html') (Join-Path $DEST 'index.html') -Force

New-Item -ItemType Directory -Force -Path (Join-Path $DEST 'styles') | Out-Null
Copy-Item (Join-Path $STYLES '*.css') (Join-Path $DEST 'styles') -Force

New-Item -ItemType Directory -Force -Path (Join-Path $DEST 'js') | Out-Null
# recursive: js\vendor\peerjs.min.js must come along
Copy-Item (Join-Path $JS '*') (Join-Path $DEST 'js') -Recurse -Force

New-Item -ItemType Directory -Force -Path (Join-Path $DEST 'audio') | Out-Null
if (Test-Path (Join-Path $AUDIO 'tracks.js')) {
    Copy-Item (Join-Path $AUDIO 'tracks.js') (Join-Path $DEST 'audio') -Force
}
Get-ChildItem $AUDIO -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -match '^\.(mp3|ogg|m4a|flac|wav)$' } |
    ForEach-Object { Copy-Item $_.FullName (Join-Path $DEST 'audio') -Force }

Write-Host '=== 3. verify required files ==='
$must = @(
    'index.html',
    'styles\base.css', 'styles\scene.css', 'styles\prologue.css',
    'styles\board.css', 'styles\hud.css', 'styles\fx.css',
    'js\data.js', 'js\element-info.js', 'js\engine.js', 'js\view.js',
    'js\ui.js', 'js\fx.js', 'js\prologue.js', 'js\prologue-audio.js',
    'js\audio.js', 'js\p2p.js', 'js\turn-config.js', 'js\net.js', 'js\main.js',
    'js\vendor\peerjs.min.js',
    'audio\tracks.js'
)
$missing = @()
foreach ($m in $must) {
    if (-not (Test-Path (Join-Path $DEST $m))) { $missing += $m }
}
if ($missing.Count -gt 0) {
    Write-Host 'MISSING: ' -NoNewline
    Write-Host ($missing -join ', ')
    throw 'deploy artifact incomplete'
}

Write-Host '=== 3b. verify every audio src registered in tracks.js exists ==='
$tracksPath = Join-Path $DEST 'audio\tracks.js'
$trackSrcs = @()
if (Test-Path $tracksPath) {
    $tjs = Get-Content $tracksPath -Raw -Encoding UTF8
    # drop block comments / line comments so the usage example is not treated as a real track
    $tjs = [regex]::Replace($tjs, '(?s)/\*.*?\*/', '')
    $tjs = [regex]::Replace($tjs, '(?m)^\s*//.*$', '')
    $trackSrcs = [regex]::Matches($tjs, "src\s*:\s*'([^']+)'") | ForEach-Object { $_.Groups[1].Value }
}
$badAudio = @()
foreach ($s in $trackSrcs) {
    $p = Join-Path $DEST ($s -replace '/', '\')
    if (-not (Test-Path $p)) { $badAudio += $s }
}
if ($badAudio.Count -gt 0) {
    Write-Host 'MISSING AUDIO: ' -NoNewline
    Write-Host ($badAudio -join ', ')
    throw 'registered audio file not copied into deploy'
}
Write-Host ('audio tracks: ' + ($trackSrcs -join ', '))

Write-Host '=== 4. verify every href/src in index.html resolves ==='
$html = Get-Content (Join-Path $DEST 'index.html') -Raw -Encoding UTF8
$refs = [regex]::Matches($html, '(?:href|src)="((?!https?:)[^"]+)"') | ForEach-Object { $_.Groups[1].Value }
$bad = @()
foreach ($r in $refs) {
    $p = Join-Path $DEST ($r -replace '/', '\')
    if (-not (Test-Path $p)) { $bad += $r }
}
if ($bad.Count -gt 0) {
    Write-Host 'BROKEN REFS: ' -NoNewline
    Write-Host ($bad -join ', ')
    throw 'index.html has broken references'
}

$files = Get-ChildItem $DEST -Recurse -File
$size = [math]::Round((($files | Measure-Object Length -Sum).Sum) / 1KB, 1)

Write-Host ''
Write-Host "OK  $($files.Count) files, $size KB total"
Write-Host "OK  $($refs.Count) refs, all resolve"
Write-Host ''
Write-Host 'next:'
Write-Host "  cd `"$ROOT`""
Write-Host '  wrangler pages deploy deploy --project-name=<project> --commit-dirty=true'
