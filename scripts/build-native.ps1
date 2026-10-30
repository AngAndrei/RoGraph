$ErrorActionPreference = 'Stop'
$repoPath = Split-Path -Parent $PSScriptRoot
Push-Location $repoPath
try {
    $cargoPath = 'C:\Users\Andrei\.rustup\toolchains\stable-x86_64-pc-windows-msvc\bin\cargo.exe'
    if (-not (Test-Path -LiteralPath $cargoPath)) { $cargoPath = (Get-Command cargo).Source }
    $env:PATH = (Split-Path -Parent $cargoPath) + ';' + $env:PATH
    & $cargoPath build --manifest-path native/rbx-import/Cargo.toml --release --locked
    if ($LASTEXITCODE -ne 0) { throw 'Importer build failed' }
    New-Item -ItemType Directory -Force -Path build/bin | Out-Null
    Copy-Item -LiteralPath native/rbx-import/target/release/rograph-rbx-import.exe -Destination build/bin/rbx-import.exe
    $cmakePath = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
    if (-not (Test-Path -LiteralPath $cmakePath)) { $cmakePath = (Get-Command cmake).Source }
    & $cmakePath -S native/luau-parser -B build/luau-parser -G 'Visual Studio 17 2022' -A x64
    if ($LASTEXITCODE -ne 0) { throw 'Parser configure failed' }
    & $cmakePath --build build/luau-parser --config Release --target luau-parser --parallel 4
    if ($LASTEXITCODE -ne 0) { throw 'Parser build failed' }
    Copy-Item -LiteralPath build/luau-parser/Release/luau-parser.exe -Destination build/bin/luau-parser.exe
} finally { Pop-Location }
