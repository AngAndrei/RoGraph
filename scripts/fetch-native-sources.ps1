$ErrorActionPreference = 'Stop'
$repoPath = Split-Path -Parent $PSScriptRoot
Push-Location $repoPath
try {
    New-Item -ItemType Directory -Force -Path vendor | Out-Null
    $env:GIT_CONFIG_GLOBAL = 'NUL'
    if (-not (Test-Path -LiteralPath vendor/luau)) {
        git clone --no-checkout https://github.com/luau-lang/luau.git vendor/luau
        if ($LASTEXITCODE -ne 0) { throw 'Luau download failed' }
        git -C vendor/luau checkout a4818b6678822bb726a0eb2299cae751d3017a6a
    }
    $revision = git -C vendor/luau rev-parse HEAD
    if ($revision -ne 'a4818b6678822bb726a0eb2299cae751d3017a6a') { throw 'Unexpected Luau source revision' }
    if (-not (Test-Path -LiteralPath vendor/json.hpp)) {
        Invoke-WebRequest https://raw.githubusercontent.com/nlohmann/json/v3.12.0/single_include/nlohmann/json.hpp -OutFile vendor/json.hpp
    }
    if ((Get-FileHash -LiteralPath vendor/json.hpp -Algorithm SHA256).Hash -ne 'AAF127C04CB31C406E5B04A63F1AE89369FCCDE6D8FA7CDDA1ED4F32DFC5DE63') { throw 'JSON library checksum mismatch' }
} finally { Pop-Location }
