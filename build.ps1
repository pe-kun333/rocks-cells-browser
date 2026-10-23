# Build Rocks-cells Browser and launch it.
#   powershell -ExecutionPolicy Bypass -File .\build.ps1            (Debug build, then run)
#   powershell -ExecutionPolicy Bypass -File .\build.ps1 -Release   (Release build, then run)
#   add -NoRun to build only
param([switch]$Release, [switch]$NoRun)
$ErrorActionPreference = 'Stop'

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'Visual Studio C++ tools were not found.' }
$cmake = Join-Path $vs 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'

$preset = if ($Release) { 'release' } else { 'debug' }
$config = if ($Release) { 'Release' } else { 'Debug' }

# Build the embedded hex-memo web version first (if ..\hex-memo exists)
$hexmemo = Join-Path $PSScriptRoot '..\hex-memo'
if (Test-Path -LiteralPath (Join-Path $hexmemo 'scripts\build-web.js')) {
    Push-Location $hexmemo
    try { & node scripts/build-web.js; if ($LASTEXITCODE -ne 0) { throw 'hex-memo web build failed.' } } finally { Pop-Location }
}

Push-Location $PSScriptRoot
try {
    & $cmake --preset x64
    if ($LASTEXITCODE -ne 0) { throw 'CMake configure failed.' }
    & $cmake --build --preset $preset
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
} finally {
    Pop-Location
}

$exe = Join-Path $PSScriptRoot "build\$config\RocksCellsBrowser.exe"
# cmake は毎回 ui をビルドして exe の横へコピーする。印が無いときは、古い dist のままなので止める
$uiIndex = Join-Path $PSScriptRoot "build\$config\ui\index.html"
if (-not (Test-Path -LiteralPath $uiIndex)) { throw "UI was not copied next to the exe ($uiIndex)." }
$marker = Select-String -LiteralPath $uiIndex -Pattern 'themes-boot' -SimpleMatch -Quiet
if (-not $marker) { throw "Copied UI is stale ($uiIndex has no themes-boot). Delete build\$config\ui and run this script again." }
Write-Host "Built: $exe"
Write-Host "UI: $uiIndex"
if (-not $NoRun) { Start-Process $exe }
