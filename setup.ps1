<#
.SYNOPSIS
    Roo Code Workflow — One-Liner Setup Script
    Bootstraps the entire workflow system into any project directory.

.DESCRIPTION
    Performs all setup steps in sequence:
    1. Runs init-workflow.ps1 to scaffold WORKFLOW/ and agent rules
    2. Installs dashboard dependencies (npm install)
    3. Validates the installation
    4. Prints next steps

.EXAMPLE
    .\setup.ps1
    .\setup.ps1 -Stack "laravel-flutter"
    .\setup.ps1 -SkipDashboard
#>

param(
    [string]$Stack = "auto",
    [switch]$SkipDashboard,
    [switch]$StartDashboard
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║   🚀 Roo Code Workflow — Setup                  ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Run init-workflow.ps1 ─────────────────────────────────────────────
$initScript = Join-Path $PSScriptRoot "init-workflow.ps1"
if (-not (Test-Path $initScript)) {
    Write-Host "  [FAIL] init-workflow.ps1 not found in $PSScriptRoot" -ForegroundColor Red
    exit 1
}

Write-Host "  [1/4] Bootstrapping WORKFLOW/ directory..." -ForegroundColor Yellow
try {
    & $initScript
    Write-Host "  [OK]  WORKFLOW/ scaffolded successfully" -ForegroundColor Green
}
catch {
    Write-Host "  [FAIL] Bootstrap failed: $_" -ForegroundColor Red
    exit 1
}

# ── Step 2: Install dashboard dependencies ────────────────────────────────────
$dashboardDir = Join-Path $PSScriptRoot "workflow-dashboard"
if (-not $SkipDashboard -and (Test-Path $dashboardDir)) {
    Write-Host "  [2/4] Installing dashboard dependencies..." -ForegroundColor Yellow
    Push-Location $dashboardDir
    try {
        & npm install --silent 2>&1 | Out-Null
        Write-Host "  [OK]  Dashboard dependencies installed" -ForegroundColor Green
    }
    catch {
        Write-Host "  [WARN] npm install failed: $_" -ForegroundColor Yellow
        Write-Host "         You can run 'cd workflow-dashboard && npm install' manually." -ForegroundColor Gray
    }
    Pop-Location
}
else {
    Write-Host "  [2/4] Dashboard setup skipped" -ForegroundColor Gray
}

# ── Step 3: Validate installation ─────────────────────────────────────────────
Write-Host "  [3/4] Validating installation..." -ForegroundColor Yellow
$checks = @(
    @{ Name = "WORKFLOW/ directory"; Path = "WORKFLOW" },
    @{ Name = "ORCHESTRATION_STATUS.json"; Path = "WORKFLOW/ORCHESTRATION_STATUS.json" },
    @{ Name = ".roomodes"; Path = ".roomodes" },
    @{ Name = "orchestrator.ps1"; Path = "orchestrator.ps1" }
)

$allPassed = $true
foreach ($check in $checks) {
    $fullPath = Join-Path $PSScriptRoot $check.Path
    if (Test-Path $fullPath) {
        Write-Host "  [OK]  $($check.Name)" -ForegroundColor Green
    }
    else {
        Write-Host "  [FAIL] $($check.Name) not found" -ForegroundColor Red
        $allPassed = $false
    }
}

if (-not $allPassed) {
    Write-Host "`n  Setup completed with warnings. Some files may need manual creation." -ForegroundColor Yellow
}

# ── Step 4: Print next steps ──────────────────────────────────────────────────
Write-Host ""
Write-Host "  [4/4] Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "  ┌─────────────────────────────────────────────────┐" -ForegroundColor Gray
Write-Host "  │  Next Steps:                                    │" -ForegroundColor Gray
Write-Host "  │                                                 │" -ForegroundColor Gray
Write-Host "  │  1. Start the dashboard:                        │" -ForegroundColor Gray
Write-Host "  │     cd workflow-dashboard && npm start           │" -ForegroundColor White
Write-Host "  │                                                 │" -ForegroundColor Gray
Write-Host "  │  2. Open your browser:                          │" -ForegroundColor Gray
Write-Host "  │     http://localhost:3000                        │" -ForegroundColor White
Write-Host "  │                                                 │" -ForegroundColor Gray
Write-Host "  │  3. Begin your first workflow cycle:            │" -ForegroundColor Gray
Write-Host "  │     .\orchestrator.ps1 -Next                    │" -ForegroundColor White
Write-Host "  │                                                 │" -ForegroundColor Gray
Write-Host "  └─────────────────────────────────────────────────┘" -ForegroundColor Gray
Write-Host ""

# ── Optional: Auto-start dashboard ───────────────────────────────────────────
if ($StartDashboard -and (Test-Path $dashboardDir)) {
    Write-Host "  Starting dashboard..." -ForegroundColor Cyan
    Push-Location $dashboardDir
    & npm start
    Pop-Location
}
