# Record the demo video and the two layout images of Rocks-cells Browser.
#   powershell -ExecutionPolicy Bypass -File .\tools\demo\record.ps1
#   options: -Exe <path to RocksCellsBrowser.exe>  -Keep (keep the captured frames)
# Needs Node.js and Python 3. Uses a fresh temporary profile (your tabs, cookies and hex-memo are not touched),
# practice-mode AI (no API cost) and sample pages/audio made by make_site.py.
# A test window opens and is operated automatically for about 4 minutes, then the video is put together
# for about 3 more minutes. Results go to demo\ (honeycomb-demo.mp4 and two PNG images).
param(
    [string]$Exe = (Join-Path $PSScriptRoot '..\..\build\Debug\RocksCellsBrowser.exe'),
    [string]$Out = (Join-Path $PSScriptRoot '..\..\demo'),
    [int]$Port = 9333,
    [switch]$Keep
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
foreach ($tool in 'node', 'python') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool was not found." }
}
if (-not (Test-Path $Exe)) { throw "RocksCellsBrowser.exe was not found: $Exe (build it first with build.ps1)" }
foreach ($check in @(@{ Url = "http://127.0.0.1:$Port/json"; What = 'another test browser' }, @{ Url = 'http://127.0.0.1:8766/'; What = 'another demo server (python server.py)' })) {
    try {
        Invoke-WebRequest -UseBasicParsing $check.Url -TimeoutSec 2 | Out-Null
        throw "$($check.Url) is already in use by $($check.What). Close it first."
    } catch [System.Net.WebException] { }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$frames = Join-Path $here "frames\$stamp"
$outTmp = Join-Path $here 'out'
$data = Join-Path $env:TEMP "hc-demo-$stamp"
$hexHome = Join-Path $env:TEMP "hc-demohex-$stamp"
New-Item -ItemType Directory -Force $frames, $outTmp, $data, $hexHome, $Out | Out-Null
foreach ($old in 'done.json', 'error.txt', 'honeycomb-demo.mp4') {
    $f = Join-Path $outTmp $old
    if (Test-Path $f) { Remove-Item $f }
}

Write-Host '1/5 sample pages and audio'
& python (Join-Path $here 'make_site.py') | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'make_site.py failed.' }

$server = $null; $app = $null; $capture = $null
try {
    Write-Host '2/5 local server and a test browser (temporary profile)'
    $server = Start-Process python -ArgumentList "`"$(Join-Path $here 'server.py')`"" -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds 1
    if ($server.HasExited) { throw 'server.py did not start (is port 8766 in use?).' }
    $env:ROCKSCELLS_DATA_DIR = $data
    $env:HEX_MEMO_HOME = $hexHome
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port"
    $app = Start-Process $Exe -PassThru
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $null
    $env:ROCKSCELLS_DATA_DIR = $null
    $env:HEX_MEMO_HOME = $null
    $deadline = (Get-Date).AddSeconds(30)
    while ($true) {
        try { Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/json" -TimeoutSec 2 | Out-Null; break } catch { }
        if ((Get-Date) -gt $deadline) { throw 'The test browser did not start.' }
        Start-Sleep -Milliseconds 500
    }
    Start-Sleep -Seconds 2

    Write-Host '3/5 recording the scenes (do not touch the test window)'
    $capture = Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$(Join-Path $here 'capture.ps1')`"", '-Dir', "`"$frames`"", '-Pid0', $app.Id -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds 2
    & node (Join-Path $here 'drive.mjs') $Port $frames (Join-Path $here 'media')
    $driveOk = $LASTEXITCODE -eq 0
    New-Item -ItemType File (Join-Path $frames 'stop') | Out-Null
    $capture | Wait-Process -Timeout 30
    if (-not $driveOk) { throw 'drive.mjs failed (see the message above).' }

    Write-Host '4/5 putting the video together (about 3 minutes)'
    & node (Join-Path $here 'open.mjs') $Port "http://127.0.0.1:8766/compose.html?dir=frames/$stamp"
    if ($LASTEXITCODE -ne 0) { throw 'open.mjs failed.' }
    $deadline = (Get-Date).AddMinutes(12)
    while (-not (Test-Path (Join-Path $outTmp 'done.json'))) {
        if (Test-Path (Join-Path $outTmp 'error.txt')) { throw ('compose failed: ' + (Get-Content (Join-Path $outTmp 'error.txt') -Raw)) }
        if ((Get-Date) -gt $deadline) { throw 'Putting the video together took too long.' }
        Start-Sleep -Seconds 3
    }

    Write-Host '5/5 saving'
    & python (Join-Path $here 'remux.py') (Join-Path $outTmp 'honeycomb-demo.mp4') (Join-Path $Out 'honeycomb-demo.mp4')
    if ($LASTEXITCODE -ne 0) { throw 'remux.py failed.' }
    Get-ChildItem $outTmp -Filter *.png | Copy-Item -Destination $Out -Force
    Write-Host "Done: $((Resolve-Path $Out).Path)"
} finally {
    if ($capture -and -not $capture.HasExited) { $capture | Stop-Process -Force }
    if ($app -and -not $app.HasExited) { $app | Stop-Process -Force }
    if ($server -and -not $server.HasExited) { $server | Stop-Process -Force }
    if (-not $Keep) {
        Start-Sleep -Seconds 1
        Remove-Item -Recurse -Force $frames -ErrorAction SilentlyContinue
    }
}
