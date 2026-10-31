param([Parameter(Mandatory=$true)][string]$PackagePath)
$ErrorActionPreference='Stop'
function Get-RoGraphHash([string]$Path){$stream=[IO.File]::OpenRead($Path);$algorithm=[Security.Cryptography.SHA256]::Create();try{[BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$algorithm.Dispose()}}
$packageRoot=[IO.Path]::GetFullPath($PackagePath)
if(-not(Test-Path -LiteralPath (Join-Path $packageRoot 'RoGraph.exe'))){throw 'MISSING_LAUNCHER'}
if(-not(Test-Path -LiteralPath (Join-Path $packageRoot 'checksums.json'))){throw 'MISSING_CHECKSUMS'}
$manifest=Get-Content -LiteralPath (Join-Path $packageRoot 'checksums.json') -Raw -Encoding utf8|ConvertFrom-Json
foreach($entry in $manifest.files){$target=[IO.Path]::GetFullPath((Join-Path $packageRoot $entry.path));if(-not $target.StartsWith($packageRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'UNSAFE_MANIFEST_PATH'};if((Get-RoGraphHash $target) -ne $entry.sha256){throw "CHECKSUM_MISMATCH: $($entry.path)"}}
$repoPath=Split-Path -Parent $PSScriptRoot
Push-Location $repoPath
try{& node.exe --import tsx scripts/package-smoke.ts $packageRoot;if($LASTEXITCODE -ne 0){throw 'PORTABLE_WORKFLOW_FAILED'}}finally{Pop-Location}
