$ErrorActionPreference='Stop'
$repoPath=Split-Path -Parent $PSScriptRoot
Push-Location $repoPath
try{
    New-Item -ItemType Directory -Force -Path vendor,build/tools,build/bin|Out-Null
    $pins=Get-Content tools/versions.lock.json -Raw -Encoding utf8|ConvertFrom-Json
    if(-not(Test-Path -LiteralPath vendor/luau/Ast/include/Luau/Ast.h)){
        $archive=Join-Path $repoPath 'build/tools/luau.zip'
        Invoke-WebRequest -Uri "https://github.com/luau-lang/luau/archive/$($pins.luauCommit).zip" -OutFile $archive
        $unpack=Join-Path $repoPath ('build/tools/luau-'+[guid]::NewGuid().ToString('N'))
        Expand-Archive -LiteralPath $archive -DestinationPath $unpack
        Copy-Item -LiteralPath (Join-Path $unpack "luau-$($pins.luauCommit)") -Destination vendor/luau -Recurse
    }
    if(-not(Test-Path -LiteralPath vendor/json.hpp)){Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/nlohmann/json/v3.12.0/single_include/nlohmann/json.hpp' -OutFile vendor/json.hpp}
    if((Get-FileHash -LiteralPath vendor/json.hpp -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'aaf127c04cb31c406e5b04a63f1ae89369fccde6d8fa7cdda1ed4f32dfc5de63'){throw 'JSON_HEADER_HASH_MISMATCH'}
    if(-not(Test-Path -LiteralPath build/bin/rojo.exe)){
        Invoke-WebRequest -Uri 'https://github.com/rojo-rbx/rojo/releases/download/v7.7.1/rojo-7.7.1-windows-x86_64.zip' -OutFile build/tools/rojo.zip
        Expand-Archive -LiteralPath build/tools/rojo.zip -DestinationPath build/tools/rojo -Force
        Copy-Item -LiteralPath build/tools/rojo/rojo.exe -Destination build/bin/rojo.exe
    }
    if((Get-FileHash -LiteralPath build/bin/rojo.exe -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'e73e956676b8b27ff43f2c5d80e040121e49c2f9e8cc69fd65123799473cf6d3'){throw 'ROJO_HASH_MISMATCH'}
    foreach($asset in @(@{name='json-LICENSE.MIT';url='https://raw.githubusercontent.com/nlohmann/json/v3.12.0/LICENSE.MIT'},@{name='rojo-LICENSE.txt';url='https://raw.githubusercontent.com/rojo-rbx/rojo/v7.7.1/LICENSE.txt'},@{name='node-LICENSE';url='https://raw.githubusercontent.com/nodejs/node/v24.19.0/LICENSE'})){if(-not(Test-Path -LiteralPath (Join-Path vendor $asset.name))){Invoke-WebRequest -Uri $asset.url -OutFile (Join-Path vendor $asset.name)}}
    foreach($name in @('LICENSE-MIT','LICENSE-APACHE')){if(-not(Test-Path -LiteralPath (Join-Path vendor ('rust-'+$name)))){Invoke-WebRequest -Uri ('https://raw.githubusercontent.com/rust-lang/rust/1.90.0/'+$name) -OutFile (Join-Path vendor ('rust-'+$name))}}
    if(-not(Test-Path -LiteralPath vendor/rust-COPYRIGHT-library.html)){
        $rustSysroot=(& rustc --print sysroot)
        if($LASTEXITCODE -ne 0){throw 'RUST_TOOLCHAIN_UNAVAILABLE'}
        Copy-Item -LiteralPath (Join-Path $rustSysroot 'share/doc/rust/COPYRIGHT-library.html') -Destination vendor/rust-COPYRIGHT-library.html
    }
    Write-Output 'Pinned sources, optional Rojo binary, and redistribution notices are ready.'
}finally{Pop-Location}
