param([int]$RootPid,[string]$StopFile,[string]$OutputPath)
$ErrorActionPreference='Stop'
$peakBytes=0L;$samples=0;$observed=@{}
while(-not(Test-Path -LiteralPath $StopFile)){
    $processRows=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name
    $selected=[Collections.Generic.HashSet[int]]::new();[void]$selected.Add($RootPid)
    for($depth=0;$depth -lt 10;$depth++){$changed=$false;foreach($row in $processRows){if($selected.Contains([int]$row.ParentProcessId) -and [int]$row.ProcessId -ne $PID){if($selected.Add([int]$row.ProcessId)){$changed=$true}}};if(-not $changed){break}}
    $total=0L
    foreach($identifier in $selected){try{$entry=Get-Process -Id $identifier -ErrorAction Stop;$total+=$entry.WorkingSet64;$observed["$identifier"]=[ordered]@{name=$entry.ProcessName;peakWorkingSetBytes=$entry.PeakWorkingSet64}}catch{}}
    $peakBytes=[Math]::Max($peakBytes,$total);$samples++;Start-Sleep -Milliseconds 200
}
[ordered]@{method='Sampled sum of process-tree working sets; Node workers share the parent process; sampler excluded';sampleIntervalMs=200;peakAggregateBytes=$peakBytes;samples=$samples;observedProcesses=$observed;limitation='Short-lived helper peaks can fall between samples; shared DLL pages may be counted across processes.'}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $OutputPath -Encoding utf8
