[CmdletBinding()]
param(
    [string]$ResultsDir = "",
    [switch]$SkipBuild,
    [switch]$SkipSmoke,
    [switch]$SkipCorrectness,
    [switch]$SkipTuning,
    [switch]$SkipFull,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repoRoot

function Invoke-NativeStep {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string[]]$Command
    )

    Write-Host ""
    Write-Host "=== $Label ===" -ForegroundColor Cyan
    Write-Host ($Command -join " ") -ForegroundColor DarkGray
    if ($DryRun) {
        return
    }

    $executable = $Command[0]
    $arguments = @($Command | Select-Object -Skip 1)
    & $executable @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE"
    }
}

function Require-Command {
    param([Parameter(Mandatory = $true)][string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found in PATH."
    }
}

Require-Command "python"
Require-Command "cmake"
Require-Command "ctest"
Require-Command "git"
Require-Command "mpiexec"
Require-Command "nvidia-smi"

$commit = (& git rev-parse --short HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or -not $commit) {
    throw "Unable to determine the current Git commit."
}
$dirty = -not [string]::IsNullOrWhiteSpace((& git status --porcelain | Out-String))
if ($dirty) {
    Write-Warning "The worktree is dirty. Commit the current implementation before collecting report results."
}

if ([string]::IsNullOrWhiteSpace($ResultsDir)) {
    $ResultsDir = "results\final-$commit"
}
if (-not [System.IO.Path]::IsPathRooted($ResultsDir)) {
    $ResultsDir = Join-Path $repoRoot $ResultsDir
}
$ResultsDir = [System.IO.Path]::GetFullPath($ResultsDir)
$evaluationDir = Join-Path $ResultsDir "evaluation"
$smokeDir = Join-Path $ResultsDir "smoke"
$tuningSummaryDir = Join-Path $ResultsDir "tuning-summary"
$finalSummaryDir = Join-Path $ResultsDir "summary"
$baseConfig = Join-Path $repoRoot "benchmark\configs\evaluation.json"
$selectedConfig = Join-Path $ResultsDir "selected-evaluation.json"
$selectionRecord = Join-Path $ResultsDir "selected-configurations.json"
$correctnessManifest = Join-Path $repoRoot "benchmark\manifests\correctness.json"
$tuningManifest = Join-Path $repoRoot "benchmark\manifests\tuning.json"
$fullManifest = Join-Path $repoRoot "benchmark\manifests\full.json"
$nativeDir = Join-Path $repoRoot "build-full\Release"

New-Item -ItemType Directory -Force -Path $ResultsDir, $evaluationDir, $smokeDir | Out-Null
$logPath = Join-Path $ResultsDir ("orchestrator-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$transcriptStarted = $false

try {
    if (-not $DryRun) {
        Start-Transcript -Path $logPath | Out-Null
        $transcriptStarted = $true
    }

    Write-Host "Parallel QOI final evaluation" -ForegroundColor Green
    Write-Host "Repository : $repoRoot"
    Write-Host "Commit     : $commit"
    Write-Host "Results    : $ResultsDir"
    Write-Host "Resume     : enabled for every benchmark stage"

    Invoke-NativeStep "Record NVIDIA GPU availability" @(
        "nvidia-smi", "--query-gpu=name,driver_version", "--format=csv,noheader"
    )

    if (-not $SkipBuild) {
        Invoke-NativeStep "Configure full Release build" @("cmake", "--preset", "windows-full")
        Invoke-NativeStep "Build native backends" @("cmake", "--build", "--preset", "windows-full-release")
        Invoke-NativeStep "Run native tests" @(
            "ctest", "--test-dir", "build-full", "-C", "Release", "--output-on-failure"
        )
    }

    if (-not $DryRun) {
        foreach ($name in "pqoi_serial.exe", "pqoi_control.exe", "pqoi_openmp.exe", "pqoi_cuda.exe", "pqoi_mpi.exe") {
            if (-not (Test-Path (Join-Path $nativeDir $name))) {
                throw "Missing native backend: $(Join-Path $nativeDir $name)"
            }
        }
    }

    if (-not $SkipSmoke) {
        Invoke-NativeStep "Smoke benchmark" @(
            "python", "benchmark\scripts\run_benchmarks.py",
            "--manifest", $correctnessManifest,
            "--config", $baseConfig,
            "--stage", "correctness",
            "--native-dir", $nativeDir,
            "--output-dir", $smokeDir,
            "--mpi-launcher", "mpiexec",
            "--warmups", "0", "--runs", "1", "--resume"
        )
        Invoke-NativeStep "Verify smoke benchmark" @(
            "python", "benchmark\scripts\verify_outputs.py",
            (Join-Path $smokeDir "correctness"), "--required-runs", "1", "--require-artifacts"
        )
    }

    if (-not $SkipCorrectness) {
        Invoke-NativeStep "Formal correctness benchmark" @(
            "python", "benchmark\scripts\run_benchmarks.py",
            "--manifest", $correctnessManifest,
            "--config", $baseConfig,
            "--stage", "correctness",
            "--native-dir", $nativeDir,
            "--output-dir", $evaluationDir,
            "--mpi-launcher", "mpiexec",
            "--background-workload", "idle desktop; benchmark backends run sequentially",
            "--resume"
        )
        Invoke-NativeStep "Verify correctness benchmark" @(
            "python", "benchmark\scripts\verify_outputs.py",
            (Join-Path $evaluationDir "correctness"), "--required-runs", "5", "--require-artifacts"
        )
    }

    if (-not $SkipTuning) {
        Invoke-NativeStep "Tuning benchmark" @(
            "python", "benchmark\scripts\run_benchmarks.py",
            "--manifest", $tuningManifest,
            "--config", $baseConfig,
            "--stage", "tuning",
            "--native-dir", $nativeDir,
            "--output-dir", $evaluationDir,
            "--mpi-launcher", "mpiexec",
            "--background-workload", "idle desktop; benchmark backends run sequentially",
            "--resume"
        )
        Invoke-NativeStep "Verify tuning benchmark" @(
            "python", "benchmark\scripts\verify_outputs.py",
            (Join-Path $evaluationDir "tuning"), "--required-runs", "5"
        )
    }

    Invoke-NativeStep "Aggregate tuning results" @(
        "python", "benchmark\scripts\aggregate_results.py",
        "--input-dir", (Join-Path $evaluationDir "tuning"),
        "--output", (Join-Path $ResultsDir "tuning-per-run.csv"),
        "--summary-dir", $tuningSummaryDir
    )
    Invoke-NativeStep "Select best report configurations" @(
        "python", "benchmark\scripts\select_best_config.py",
        "--base-config", $baseConfig,
        "--manifest", $tuningManifest,
        "--suite-summary", (Join-Path $tuningSummaryDir "full-suite-summary.csv"),
        "--output", $selectedConfig,
        "--selection-output", $selectionRecord
    )

    $fullConfig = if ($DryRun) { $baseConfig } else { $selectedConfig }
    if (-not $SkipFull) {
        Invoke-NativeStep "Full 2,848-image benchmark" @(
            "python", "benchmark\scripts\run_benchmarks.py",
            "--manifest", $fullManifest,
            "--config", $fullConfig,
            "--stage", "full",
            "--native-dir", $nativeDir,
            "--output-dir", $evaluationDir,
            "--mpi-launcher", "mpiexec",
            "--background-workload", "idle desktop; benchmark backends run sequentially",
            "--resume", "--quiet"
        )
        Invoke-NativeStep "Verify full benchmark" @(
            "python", "benchmark\scripts\verify_outputs.py",
            (Join-Path $evaluationDir "full"), "--required-runs", "5"
        )
    }

    Invoke-NativeStep "Aggregate all report results" @(
        "python", "benchmark\scripts\aggregate_results.py",
        "--input-dir", $evaluationDir,
        "--output", (Join-Path $ResultsDir "per-run.csv"),
        "--summary-dir", $finalSummaryDir
    )
    Invoke-NativeStep "Create report-ready Excel workbook" @(
        "python", "benchmark\scripts\create_excel_report.py",
        "--results-dir", $finalSummaryDir,
        "--output", (Join-Path $ResultsDir "final-benchmark-report.xlsx")
    )

    if (-not $DryRun) {
        @(
            "Parallel QOI final evaluation completed successfully.",
            "Commit: $commit",
            "Completed: $(Get-Date -Format o)",
            "Results: $ResultsDir"
        ) | Set-Content -Path (Join-Path $ResultsDir "COMPLETED.txt") -Encoding UTF8
    }
    Write-Host ""
    Write-Host "Evaluation complete: $ResultsDir" -ForegroundColor Green
}
finally {
    if ($transcriptStarted) {
        Stop-Transcript | Out-Null
    }
}
