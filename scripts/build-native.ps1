$ErrorActionPreference = 'Stop'
$repoPath = Split-Path -Parent $PSScriptRoot
Push-Location $repoPath
try {
    $cargoPath = 'C:\Users\Andrei\.rustup\toolchains\stable-x86_64-pc-windows-msvc\bin\cargo.exe'
    if (-not (Test-Path -LiteralPath $cargoPath)) { $cargoPath = (Get-Command cargo).Source }
    $env:PATH = (Split-Path -Parent $cargoPath) + ';' + $env:PATH
    & $cargoPath build --manifest-path native/rbx-import/Cargo.toml --release
    if ($LASTEXITCODE -ne 0) { throw 'Importer build failed' }
    New-Item -ItemType Directory -Force -Path build/bin | Out-Null
    Copy-Item -LiteralPath native/rbx-import/target/release/rograph-rbx-import.exe -Destination build/bin/rbx-import.exe
} finally { Pop-Location }
