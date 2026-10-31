$ErrorActionPreference='Stop'
function Get-RoGraphHash([string]$Path){$stream=[IO.File]::OpenRead($Path);$algorithm=[Security.Cryptography.SHA256]::Create();try{[BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$algorithm.Dispose()}}
$repoPath=Split-Path -Parent $PSScriptRoot
Push-Location $repoPath
try {
    & npm.cmd run build
    if($LASTEXITCODE -ne 0){throw 'APP_BUILD_FAILED'}
    $cargoPath='C:\Users\Andrei\.rustup\toolchains\stable-x86_64-pc-windows-msvc\bin\cargo.exe'
    if(-not(Test-Path -LiteralPath $cargoPath)){$cargoPath=(Get-Command cargo).Source}
    $env:PATH=(Split-Path -Parent $cargoPath)+';'+$env:PATH
    $env:RUSTFLAGS='-C target-feature=+crt-static'
    & $cargoPath build --manifest-path native/launcher/Cargo.toml --release --locked
    if($LASTEXITCODE -ne 0){throw 'LAUNCHER_BUILD_FAILED'}
    $stage=Join-Path $repoPath ('build/package-stage-'+[guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stage|Out-Null
    foreach($folder in @('runtime','build/bin','samples','notices')){New-Item -ItemType Directory -Force -Path (Join-Path $stage $folder)|Out-Null}
    Copy-Item -LiteralPath native/launcher/target/release/rograph-launcher.exe -Destination (Join-Path $stage 'RoGraph.exe')
    $nodePath=(Get-Command node.exe).Source
    if((& $nodePath --version) -ne 'v24.19.0'){throw 'NODE_VERSION_MISMATCH'}
    Copy-Item -LiteralPath $nodePath -Destination (Join-Path $stage 'runtime/node.exe')
    New-Item -ItemType Directory -Force -Path (Join-Path $stage 'dist')|Out-Null
    foreach($file in @('cli.js','worker.js','schema.sql','package.json')){Copy-Item -LiteralPath (Join-Path 'dist' $file) -Destination (Join-Path $stage 'dist')}
    Copy-Item -LiteralPath dist/web -Destination (Join-Path $stage 'dist') -Recurse
    foreach($name in @('rbx-import','luau-parser','rojo')){Copy-Item -LiteralPath "build/bin/$name.exe" -Destination (Join-Path $stage "build/bin/$name.exe")}
    if((Get-RoGraphHash (Join-Path $stage 'build/bin/rojo.exe')) -ne 'e73e956676b8b27ff43f2c5d80e040121e49c2f9e8cc69fd65123799473cf6d3'){throw 'ROJO_HASH_MISMATCH'}
    Copy-Item -LiteralPath fixtures/shop/place.rbxlx -Destination (Join-Path $stage 'samples/shop.rbxlx')
    [IO.File]::WriteAllBytes((Join-Path $stage 'samples/shop.rbxl'),[Convert]::FromBase64String((Get-Content -LiteralPath fixtures/binary/shop.rbxl.base64 -Raw)))
    Copy-Item -LiteralPath docs/user-guide.md,docs/troubleshooting.md,docs/agent-setup.md,docs/performance.md,docs/performance-results.json,docs/release-validation.md,docs/provided-game-validation.md,THIRD_PARTY_NOTICES.md,tools/versions.lock.json -Destination $stage
    $env:ROGRAPH_CARGO=$cargoPath
    & node.exe --import tsx scripts/collect-notices.ts $stage
    if($LASTEXITCODE -ne 0){throw 'NOTICES_FAILED'}
    $files=@(Get-ChildItem -LiteralPath $stage -Recurse -File|ForEach-Object{[ordered]@{path=$_.FullName.Substring($stage.Length+1).Replace('\','/');sha256=(Get-RoGraphHash $_.FullName)}})
    [ordered]@{product='RoGraph';version='0.1.0';platform='windows-x64';files=$files}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $stage 'checksums.json') -Encoding utf8
    $destination=Join-Path $repoPath 'dist/windows-x64'
    New-Item -ItemType Directory -Force -Path $destination|Out-Null
    # Copy only release files; an existing user's workspace is preserved and never enters the ZIP.
    foreach($entry in Get-ChildItem -LiteralPath $stage -Force){Copy-Item -LiteralPath $entry.FullName -Destination $destination -Recurse -Force}
    $archive=Join-Path $repoPath 'dist/RoGraph-0.1.0-windows-x64.zip'
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $archive -Force
    $resolvedStage=[IO.Path]::GetFullPath($stage)
    $buildRoot=[IO.Path]::GetFullPath((Join-Path $repoPath 'build'))
    if(-not $resolvedStage.StartsWith($buildRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolvedStage) -notmatch '^package-stage-[a-f0-9]+$'){throw 'UNSAFE_STAGE_CLEANUP'}
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
    Write-Output "Portable package: $destination"
    Write-Output "Archive: $archive"
}finally{Pop-Location}
