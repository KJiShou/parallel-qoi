@echo off
setlocal
cd /d "%~dp0"

echo Parallel QOI Final Evaluation
echo This can take several days. Closing this window stops the current run.
echo Run this file again to resume completed benchmark artifacts.
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0benchmark\scripts\run_final_evaluation.ps1"
set "runExitCode=%ERRORLEVEL%"

echo.
if "%runExitCode%"=="0" (
    echo Evaluation completed successfully.
) else (
    echo Evaluation stopped or failed with exit code %runExitCode%.
    echo Fix the reported issue, then run this file again to resume.
)
echo.
pause
exit /b %runExitCode%
