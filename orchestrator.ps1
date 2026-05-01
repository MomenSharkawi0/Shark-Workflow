<#
.SYNOPSIS
    Roo Code Workflow Orchestrator v3 - Automates the 3-mode workflow cycle with JSON state, git integration, and pre-flight validation.

.DESCRIPTION
    Manages the Director -> Planner -> Executor workflow cycle using ORCHESTRATION_STATUS.json
    as the single source of truth. Quality gates validate each transition. Git integration
    provides auditable commits at every state change. Pre-flight checks catch broken environments.

.PARAMETER Status
    Shows current workflow status without making changes.

.PARAMETER Reset
    Resets the workflow to INIT state and cleans ACTIVE directory.

.PARAMETER Next
    Advances to the next state in the workflow.

.PARAMETER Undo
    Rolls back to the previous state (one step back).

.PARAMETER Resume
    Resets RetryCount to 0 and re-enters EXECUTION (for use after manual ESCALATION resolution).

.PARAMETER InjectPlan
    Inject external plan and bypass planning phases directly to EXECUTION.

.PARAMETER SkipGit
    Skip git commit/tag creation for this transition (opt-out).

.PARAMETER Plan
    Launch the interactive Plan wizard to create a guided feature request.

.EXAMPLE
    .\orchestrator.ps1 -Status
    .\orchestrator.ps1 -Reset
    .\orchestrator.ps1 -Next
    .\orchestrator.ps1 -Undo
    .\orchestrator.ps1 -Resume
    .\orchestrator.ps1 -InjectPlan "C:\path\to\plan.md"
    .\orchestrator.ps1 -Plan
#>

param(
    [switch]$Status,
    [switch]$Reset,
    [switch]$Next,
    [switch]$Undo,
    [switch]$Resume,
    [string]$InjectPlan,
    [switch]$SkipGit,
    [switch]$Plan,
    [switch]$Interactive
)

$ErrorActionPreference = "Stop"
$WorkflowDir = "WORKFLOW"
$ActiveDir = "$WorkflowDir/ACTIVE"
$SnapshotsDir = "$WorkflowDir/SNAPSHOTS"
$StatusFile = "$WorkflowDir/ORCHESTRATION_STATUS.json"
$MetricsFile = "$WorkflowDir/METRICS.json"
$DashboardFile = "$WorkflowDir/QUALITY_DASHBOARD.md"
$ManifestFile = "$WorkflowDir/MANIFEST.json"
$QualityGatesFile = "$ActiveDir/QUALITY_GATES.md"
$LessonsLearnedFile = "$WorkflowDir/LESSONS_LEARNED.md"
$PhaseDNAFile = "$WorkflowDir/PHASE_DNA.md"
$HistoryLogFile = "$WorkflowDir/HISTORY/HISTORY_LOG.md"
$HistoryDir = "$WorkflowDir/HISTORY"
$PlansDir = "plans"
$LogFile = "$WorkflowDir/orchestrator.log"
$LockFile = "$WorkflowDir/.lock"

# Files to archive during ARCHIVE -> COMPLETE transition
$FilesToArchive = @(
    "PHASE_PLAN.md",
    "DETAILED_PLAN.md",
    "PLAN_REVIEW.md",
    "PLAN_APPROVED.md",
    "EXECUTION_REPORT.md",
    "EXECUTION_REPORT_BACKEND.md",
    "EXECUTION_REPORT_FRONTEND.md",
    "EXECUTION_REVIEW.md"
)

# Workflow States (ordered)
$StateOrder = @("INIT","PHASE_PLANNING","DETAILED_PLANNING","PLAN_REVIEW","EXECUTION","EXECUTION_BACKEND","EXECUTION_FRONTEND","EXECUTION_REVIEW","ARCHIVE","COMPLETE")
$States = @{
    "INIT"               = 0
    "PHASE_PLANNING"     = 1
    "DETAILED_PLANNING"  = 2
    "PLAN_REVIEW"        = 3
    "EXECUTION"          = 4
    "EXECUTION_BACKEND"  = 5
    "EXECUTION_FRONTEND" = 6
    "EXECUTION_REVIEW"   = 7
    "ARCHIVE"            = 8
    "COMPLETE"           = 9
}

# State configurations
$StateConfigs = @{
    "INIT"              = @{
        ActiveMode  = "User"
        OutputFile  = $null
        NextMode    = "director"
        Instruction = "Provide a feature request to the Director"
        NextState   = "PHASE_PLANNING"
    }
    "PHASE_PLANNING"    = @{
        ActiveMode  = "Director"
        OutputFile  = "PHASE_PLAN.md"
        NextMode    = "planner"
        Instruction = "Switch to Director mode and write PHASE_PLAN.md for the requested feature"
        NextState   = "DETAILED_PLANNING"
    }
    "DETAILED_PLANNING" = @{
        ActiveMode  = "Planner"
        OutputFile  = "DETAILED_PLAN.md"
        NextMode    = "director"
        Instruction = "Switch to Planner mode and write DETAILED_PLAN.md based on PHASE_PLAN.md"
        NextState   = "PLAN_REVIEW"
    }
    "PLAN_REVIEW"       = @{
        ActiveMode   = "Director"
        OutputFile   = "PLAN_REVIEW.md"
        NextMode     = "planner"
        Instruction  = "Switch to Director mode and review DETAILED_PLAN.md. Write PLAN_REVIEW.md with APPROVED or NEEDS_REVISION"
        NextState    = "EXECUTION"
        AltNextState = "DETAILED_PLANNING"
    }
    "EXECUTION"         = @{
        ActiveMode  = "Executor"
        OutputFile  = "EXECUTION_REPORT.md"
        NextMode    = "director"
        Instruction = "Switch to Executor mode and implement the plan. Write EXECUTION_REPORT.md with test results"
        NextState   = "EXECUTION_REVIEW"
        AltNextState = "EXECUTION_BACKEND"
    }
    "EXECUTION_BACKEND" = @{
        ActiveMode  = "Executor"
        OutputFile  = "EXECUTION_REPORT_BACKEND.md"
        NextMode    = "executor"
        Instruction = "Switch to Executor mode. Implement ONLY backend changes (Laravel/PHP). Write EXECUTION_REPORT_BACKEND.md."
        NextState   = "EXECUTION_FRONTEND"
    }
    "EXECUTION_FRONTEND" = @{
        ActiveMode  = "Executor"
        OutputFile  = "EXECUTION_REPORT_FRONTEND.md"
        NextMode    = "director"
        Instruction = "Switch to Executor mode. Implement ONLY frontend changes (Flutter/Dart). Write EXECUTION_REPORT_FRONTEND.md."
        NextState   = "EXECUTION_REVIEW"
    }
    "EXECUTION_REVIEW"  = @{
        ActiveMode   = "Director"
        OutputFile   = "EXECUTION_REVIEW.md"
        NextMode     = "executor"
        Instruction  = "Switch to Director mode. Read EXECUTION_REPORT.md AND EXECUTION_DIFF.diff. Write EXECUTION_REVIEW.md with APPROVED or NEEDS_REVISION"
        NextState    = "ARCHIVE"
        AltNextState = "EXECUTION"
    }
    "ARCHIVE"           = @{
        ActiveMode  = "Director"
        OutputFile  = $null
        NextMode    = $null
        Instruction = "Switch to Director mode. Read all WORKFLOW/ACTIVE/*.md phase files to extract insights. Update WORKFLOW/LESSONS_LEARNED.md and WORKFLOW/PHASE_DNA.md with lessons from this cycle. Do NOT move or delete any files -- saving to history is handled automatically by the orchestrator. When learning files are saved, run: orchestrator.ps1 -Next"
        NextState   = "COMPLETE"
    }
    "COMPLETE"          = @{
        ActiveMode  = $null
        OutputFile  = $null
        NextMode    = $null
        Instruction = "Workflow complete! All files archived and learning system updated."
        NextState   = $null
    }
}

# ============================================================================
# LOGGING & INFRASTRUCTURE
# ============================================================================

function Write-Log {
    <#
    .SYNOPSIS
        Structured logging to both console and log file.
        Standardized prefixes: [OK], [WARN], [FAIL], [INFO], [SKIP], [GIT], [GATE]
    #>
    param(
        [ValidateSet("OK","WARN","FAIL","INFO","SKIP","GIT","GATE","LOCK")]
        [string]$Level = "INFO",
        [string]$Message,
        [switch]$NoFile
    )

    $colorMap = @{
        "OK"   = "Green"
        "WARN" = "Yellow"
        "FAIL" = "Red"
        "INFO" = "Gray"
        "SKIP" = "Gray"
        "GIT"  = "Green"
        "GATE" = "Cyan"
        "LOCK" = "DarkGray"
    }

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $prefix = "  [$Level]"
    $color = $colorMap[$Level]

    Write-Host "$prefix $Message" -ForegroundColor $color

    if (-not $NoFile) {
        $logLine = "$timestamp [$Level] $Message"
        try {
            if (-not (Test-Path $WorkflowDir)) {
                New-Item -ItemType Directory -Path $WorkflowDir -Force | Out-Null
            }
            Add-Content -Path $LogFile -Value $logLine -Encoding UTF8 -ErrorAction SilentlyContinue
        }
        catch {
            # Silently ignore log write failures
        }
    }
}

function Invoke-AtomicJsonWrite {
    <#
    .SYNOPSIS
        Atomic JSON file write: writes to a .tmp file first, then renames.
        Prevents partial writes from corrupting the status file.
    #>
    param(
        [string]$Path,
        [string]$JsonContent
    )

    $dir = Split-Path $Path -Parent
    if (-not [string]::IsNullOrEmpty($dir) -and -not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    $tmpPath = "$Path.tmp"
    Set-Content -Path $tmpPath -Value $JsonContent -Encoding UTF8
    Move-Item -Path $tmpPath -Destination $Path -Force
}

function Invoke-Lock {
    <#
    .SYNOPSIS
        Acquires a file-based lock to prevent concurrent orchestrator runs.
        Waits up to 10 seconds. Stale locks (>60s) are auto-removed.
    #>
    $maxWait = 10
    $waited = 0

    while (Test-Path $LockFile) {
        # Check for stale lock (older than 60 seconds)
        try {
            $lockAge = (Get-Date) - (Get-Item $LockFile).LastWriteTime
            if ($lockAge.TotalSeconds -gt 60) {
                Write-Log -Level WARN -Message "Removing stale lock file (age: $([math]::Round($lockAge.TotalSeconds))s)"
                Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
                break
            }
        }
        catch { break }

        if ($waited -ge $maxWait) {
            throw "Another orchestrator instance is running (lock file: $LockFile). Wait or delete the lock file manually."
        }
        Write-Log -Level LOCK -Message "Waiting for lock... ($waited/$maxWait seconds)"
        Start-Sleep -Seconds 1
        $waited++
    }

    # Acquire lock
    $lockContent = @{ pid = $PID; timestamp = (Get-Date -Format "o") } | ConvertTo-Json
    Set-Content -Path $LockFile -Value $lockContent -Encoding UTF8
}

function Invoke-Unlock {
    <#
    .SYNOPSIS
        Releases the file-based lock.
    #>
    if (Test-Path $LockFile) {
        Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
    }
}

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

function Get-CurrentState {
    if (-not (Test-Path $StatusFile)) {
        return "INIT"
    }
    try {
        $json = Get-Content $StatusFile -Raw -Encoding UTF8 | ConvertFrom-Json
        return $json.currentState
    }
    catch {
        return "INIT"
    }
}

function Get-StatusData {
    param([string]$State = (Get-CurrentState))

    $defaults = @{
        "Phase"            = ""
        "Cycle Start"      = ""
        "Cycle Id"         = ""
        "Last Transition"  = ""
        "Transition Count" = "0"
        "Retry Count"      = "0"
        "Next Action"      = ""
        "Next Mode"        = ""
        "Status"           = "IN_PROGRESS"
        "Blocked Reason"   = ""
        "Previous State"   = ""
        "Autopilot"        = $false
        "Schema Version"   = 0
    }

    if (Test-Path $StatusFile) {
        try {
            $json = Get-Content $StatusFile -Raw -Encoding UTF8 | ConvertFrom-Json

            # Schema version validation: warn (don't block) on mismatch.
            $rawSchema = if ($json.PSObject.Properties.Name -contains 'schemaVersion') { $json.schemaVersion } else { 0 }
            if ($rawSchema -gt $Script:StatusSchemaVersion) {
                Write-Log -Level WARN -Message "ORCHESTRATION_STATUS.json schemaVersion=$rawSchema is newer than orchestrator's $Script:StatusSchemaVersion. Field drift possible."
            }

            $defaults["Phase"]            = $json.phase
            $defaults["Cycle Start"]      = $json.cycleStart
            $defaults["Cycle Id"]         = if ($json.PSObject.Properties.Name -contains 'cycleId') { [string]$json.cycleId } else { "" }
            $defaults["Last Transition"]  = $json.lastTransition
            $defaults["Transition Count"] = [string]$json.transitionCount
            $defaults["Retry Count"]      = [string]$json.retryCount
            $defaults["Next Action"]      = $json.nextAction
            $defaults["Next Mode"]        = $json.nextMode
            $defaults["Status"]           = $json.status
            $defaults["Blocked Reason"]   = $json.blockedReason
            $defaults["Previous State"]   = $json.previousState
            $defaults["Autopilot"]        = if ($json.autopilot) { $true } else { $false }
            $defaults["Schema Version"]   = $rawSchema
        }
        catch {
            Write-Log -Level WARN -Message "ORCHESTRATION_STATUS.json could not be parsed; treating as INIT defaults."
        }
    }

    return $defaults
}

$Script:StatusSchemaVersion = 1

function Write-StatusFile {
    param(
        [string]$State,
        [string]$Phase = "",
        [string]$CycleStart = "",
        [string]$CycleId = "",
        [string]$LastTransition = (Get-Date -Format "o"),
        [int]$TransitionCount = 0,
        [int]$RetryCount = 0,
        [string]$NextAction = "",
        [string]$NextMode = "",
        [string]$Status = "IN_PROGRESS",
        [string]$BlockedReason = "",
        [string]$PreviousState = "",
        [bool]$Autopilot = $false,
        [int]$PhaseIndex = 0,
        [int]$PhaseTotal = 0
    )

    # Read existing JSON once so we can preserve fields the caller didn't touch.
    $existing = $null
    if (Test-Path $StatusFile) {
        try { $existing = Get-Content $StatusFile -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $existing = $null }
    }

    if (-not $PSBoundParameters.ContainsKey('Autopilot')) {
        $Autopilot = if ($existing -and $existing.autopilot) { $true } else { $false }
    }

    $parallelTracks = if ($existing -and $existing.parallelTracks) { $true } else { $false }

    if (-not $PSBoundParameters.ContainsKey('CycleId') -or [string]::IsNullOrEmpty($CycleId)) {
        if ($existing -and $existing.cycleId) {
            $CycleId = [string]$existing.cycleId
        }
    }
    # Generate a new cycleId at the start of a fresh cycle (PHASE_PLANNING with empty previous CycleId)
    if ([string]::IsNullOrEmpty($CycleId) -and $State -ne "INIT") {
        $CycleId = [guid]::NewGuid().ToString().Substring(0,8)
    }

    # Preserve phaseIndex/phaseTotal across writes when caller didn't supply them.
    $effectivePhaseIndex = if ($PSBoundParameters.ContainsKey('PhaseIndex') -and $PhaseIndex -gt 0) { $PhaseIndex }
                           elseif ($existing -and $existing.phaseIndex) { [int]$existing.phaseIndex } else { 0 }
    $effectivePhaseTotal = if ($PSBoundParameters.ContainsKey('PhaseTotal') -and $PhaseTotal -gt 0) { $PhaseTotal }
                           elseif ($existing -and $existing.phaseTotal) { [int]$existing.phaseTotal } else { 0 }

    $json = [ordered]@{
        schemaVersion    = $Script:StatusSchemaVersion
        currentState     = $State
        previousState    = $PreviousState
        phase            = $Phase
        cycleId          = $CycleId
        cycleStart       = $CycleStart
        lastTransition   = $LastTransition
        transitionCount  = $TransitionCount
        retryCount       = $RetryCount
        nextAction       = $NextAction
        nextMode         = $NextMode
        status           = $Status
        blockedReason    = $BlockedReason
        autopilot        = $Autopilot
        parallelTracks   = $parallelTracks
        phaseIndex       = $effectivePhaseIndex
        phaseTotal       = $effectivePhaseTotal
    }

    $jsonString = $json | ConvertTo-Json -Depth 3
    Invoke-AtomicJsonWrite -Path $StatusFile -JsonContent $jsonString
}

function Get-WorkflowConfig {
    <#
    .SYNOPSIS
        Reads WORKFLOW/workflow-config.json with sensible defaults. Returns a
        hashtable so callers can use ContainsKey checks. Missing fields fall
        back to defaults; corrupted JSON is reported once and defaults used.
    #>
    $defaults = @{
        testingMode  = 'post-hoc'   # 'tdd' | 'post-hoc' | 'none'
        strictReview = $false
    }

    $configPath = Join-Path $WorkflowDir 'workflow-config.json'
    if (-not (Test-Path $configPath)) {
        return $defaults
    }

    try {
        $raw = Get-Content $configPath -Raw -Encoding UTF8
        $cfg = $raw | ConvertFrom-Json

        $merged = @{}
        foreach ($k in $defaults.Keys) { $merged[$k] = $defaults[$k] }
        if ($cfg.PSObject.Properties.Match('testingMode').Count -gt 0 -and $cfg.testingMode) {
            $merged.testingMode = [string]$cfg.testingMode
        }
        if ($cfg.PSObject.Properties.Match('strictReview').Count -gt 0) {
            $merged.strictReview = [bool]$cfg.strictReview
        }
        return $merged
    } catch {
        Write-Log -Level WARN -Message "Could not parse workflow-config.json -- using defaults. ($_)"
        return $defaults
    }
}

function Write-CurrentInstruction {
    <#
    .SYNOPSIS
        Writes WORKFLOW/ACTIVE/CURRENT_INSTRUCTION.md so the active agent always
        has a fresh "what to do now" prompt. Injected by ContextInjector for
        every Roo mode and read by the `roo-code.resumeWorkflow` command.
        Wiped on every transition so stale instructions never linger.
    #>
    param(
        [string]$State,
        [string]$ActiveMode,
        [string]$Instruction
    )

    if (-not (Test-Path $ActiveDir)) {
        New-Item -ItemType Directory -Path $ActiveDir -Force | Out-Null
    }

    $timestamp = Get-Date -Format 'o'
    $modeLabel = if ($ActiveMode) { $ActiveMode.ToUpper() } else { '(workflow paused -- no active role)' }
    $instructionText = if ($Instruction) { $Instruction } else { 'No further action required for this state.' }

    $content = @"
# Current Instruction

> Auto-written by ``orchestrator.ps1`` on every state transition. Always reflects the next action for the active role. Safe to overwrite.

- **State:** $State
- **Active Mode:** $modeLabel
- **Updated:** $timestamp

## What to do now

$instructionText

---

If you are reading this in a fresh agent turn, that means the workflow just transitioned roles. Adopt the **$modeLabel** persona, perform the action above, and (if autopilot is ON in ``ORCHESTRATION_STATUS.json``) run ``.\orchestrator.ps1 -Next`` when finished.
"@

    $instructionPath = Join-Path $ActiveDir 'CURRENT_INSTRUCTION.md'
    Set-Content -Path $instructionPath -Value $content -Encoding UTF8
}

function Invoke-ManifestCheck {
    <#
    .SYNOPSIS
        Checks if MANIFEST.json exists and warns on version mismatch.
        Does not block execution - only warns.
    #>
    if (-not (Test-Path $ManifestFile)) {
        Write-Log -Level INFO -Message "MANIFEST.json not found. Run init-workflow.ps1 to generate."
        return
    }
    try {
        $manifest = Get-Content $ManifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($manifest.version -notin @("3.0","3.1","3.1.0","3.2","3.2.0")) {
            Write-Log -Level WARN -Message "MANIFEST version: $($manifest.version) - orchestrator expects 3.x. Consider re-running init-workflow.ps1."
        }
        Write-Log -Level INFO -Message "Workflow v$($manifest.version) | Stack: $($manifest.stack) | Installed: $($manifest.installedAt)"
    }
    catch {
        Write-Log -Level WARN -Message "Could not parse MANIFEST.json."
    }
}

function Invoke-GitCommit {
    param(
        [string]$FromState,
        [string]$ToState,
        [string]$PhaseName = "",
        [int]$TransitionCount = 0
    )

    if ($SkipGit) {
        Write-Log -Level SKIP -Message "Git commit skipped ( -SkipGit )"
        return
    }

    $gitCheck = & git rev-parse --git-dir 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Log -Level SKIP -Message "Not a git repository"
        return
    }

    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $msg = "chore(workflow): [$FromState -> $ToState] Phase: $PhaseName"
    $tag = "workflow/$timestamp/$ToState"

    & git add -A 2>&1 | Out-Null
    & git commit -m $msg 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        & git tag $tag 2>&1 | Out-Null
        Write-Log -Level GIT -Message "Committed + tagged: $tag"
    }
    else {
        Write-Log -Level INFO -Message "Git: nothing to commit (no changes)."
    }
}

function Invoke-PreflightCheck {
    <#
    .SYNOPSIS
        Pre-flight environment validation run before EXECUTION state.
        Exits with warning but does NOT block (soft gate by default).
    #>
    param([switch]$Blocking)

    Write-Host "`n=== PRE-FLIGHT CHECK (Gate 0) ===" -ForegroundColor Cyan
    $allPassed = $true
    $results = @()

    # Check 1: Is the active directory writable?
    if (-not (Test-Path $ActiveDir)) {
        Write-Log -Level FAIL -Message "ACTIVE directory missing: $ActiveDir"
        $allPassed = $false
        $results += "ACTIVE dir missing"
    }
    else {
        Write-Log -Level OK -Message "ACTIVE directory exists"
    }

    # Check 2: Does PLAN_APPROVED.md exist?
    $planPath = Join-Path $ActiveDir "PLAN_APPROVED.md"
    if (-not (Test-Path $planPath)) {
        Write-Log -Level FAIL -Message "PLAN_APPROVED.md not found in ACTIVE/"
        $allPassed = $false
        $results += "PLAN_APPROVED.md missing"
    }
    else {
        Write-Log -Level OK -Message "PLAN_APPROVED.md found"
    }

    # Check 3: .env check (if Laravel project detected)
    if (Test-Path ".env") {
        Write-Log -Level OK -Message ".env file found"
    }
    elseif (Test-Path "artisan") {
        Write-Log -Level WARN -Message "No .env file found in Laravel project root"
        $results += "Missing .env"
    }

    # Check 4: package.json? Try quick npm check
    if (Test-Path "package.json") {
        $npmResult = & npm ls --depth=0 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Log -Level OK -Message "Node dependencies resolved"
        }
        else {
            Write-Log -Level WARN -Message "npm dependency check had warnings"
            $results += "npm deps"
        }
    }

    # Check 5: Flutter pubspec.yaml
    if (Test-Path "pubspec.yaml") {
        Write-Log -Level INFO -Message "Flutter project detected - run 'flutter pub get' before EXECUTION if not already done"
    }

    Write-Host "=== PRE-FLIGHT COMPLETE ===" -ForegroundColor Cyan

    if (-not $allPassed -and $Blocking) {
        throw "Pre-flight Gate 0 FAILED: $($results -join ', ')"
    }

    $gateNotes = if ($allPassed) { "All checks passed" } else { "Warnings: $($results -join ', ')" }
    Write-QualityGateResult -GateNumber 0 -GateName "Pre-flight Environment Check" -Passed $allPassed -Notes $gateNotes

    return $allPassed
}

# ============================================================================
# QUALITY GATE FUNCTIONS
# ============================================================================

function Write-QualityGateResult {
    param(
        [int]$GateNumber,
        [string]$GateName,
        [bool]$Passed,
        [string]$Notes = ""
    )

    $result = if ($Passed) { "PASS" } else { "FAIL" }
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $gateNumStr = "Gate $GateNumber`: $GateName"
    $sep = [char]0x7C  # pipe character
    $entry = "$sep $timestamp $sep $gateNumStr $sep $result $sep $Notes $sep"

    if (-not (Test-Path $DashboardFile)) {
        $headerLines = @(
            "# Quality Dashboard",
            "",
            "$sep Timestamp $sep Gate $sep Result $sep Notes $sep",
            "$sep-----------$sep------$sep--------$sep-------$sep"
        )
        Set-Content -Path $DashboardFile -Value ($headerLines -join "`n")
    }

    Add-Content -Path $DashboardFile -Value $entry
}

function Test-ExecutionReportGate {
    <#
    .SYNOPSIS
        Gate 4 logic shared by EXECUTION, EXECUTION_BACKEND, EXECUTION_FRONTEND.
        Accepts "## Files Modified", "## Files Created", or "## Files Changed".
        Tests-Run section is required unless workflow-config.json sets
        testingMode=none, in which case `_Skipped: testingMode=none_` (anywhere
        in the report) also satisfies the test requirement.

        NOTE: Keep this in sync with GateValidator.ts (the in-editor twin).
    #>
    param(
        [string]$Content,
        [string]$ReportLabel,
        [string]$GateLabel,
        [string]$GateName
    )

    $missing = @()

    if ($Content -notmatch '(?m)^##\s+Files (Modified|Created|Changed)\b') {
        $missing += 'Files Modified|Created|Changed'
    }

    $cfg = Get-WorkflowConfig
    $testingMode = if ($cfg.ContainsKey('testingMode')) { $cfg.testingMode } else { 'post-hoc' }
    $hasTestsHeader = $Content -match '(?m)^##\s+Tests Run\b'
    $hasSkipMarker  = $Content -match '_Skipped:\s*testingMode=none_'

    if ($testingMode -eq 'none') {
        if (-not ($hasTestsHeader -or $hasSkipMarker)) {
            $missing += 'Tests Run (or _Skipped: testingMode=none_ marker)'
        }
    } else {
        if (-not $hasTestsHeader) { $missing += 'Tests Run' }
    }

    if ($missing.Count -gt 0) {
        throw "Quality Gate $GateLabel FAILED: $ReportLabel missing required sections: $($missing -join ', ')."
    }

    Write-QualityGateResult -GateNumber 4 -GateName $GateName -Passed $true -Notes "Report sections found (testingMode=$testingMode)"
}

function Test-QualityGate {
    param(
        [int]$GateNumber,
        [string]$GateName,
        [scriptblock]$Test
    )

    $result = & $Test
    Write-QualityGateResult -GateNumber $GateNumber -GateName $GateName -Passed $result

    if (-not $result) {
        throw "Quality Gate $GateNumber ($GateName) failed. Transition blocked."
    }

    return $result
}

# ============================================================================
# ARCHIVE FUNCTIONS
# ============================================================================

function Invoke-ArchiveFiles {
    param(
        [string]$PhaseName,
        [string]$Timestamp
    )

    Write-Host "`n=== SAVING PHASE TO HISTORY ===" -ForegroundColor Cyan
    Write-Log -Level INFO -Message "Timestamp: $Timestamp"
    Write-Log -Level INFO -Message "Phase: $PhaseName"

    $savedFiles = @()

    foreach ($filename in $FilesToArchive) {
        $sourcePath = Join-Path $ActiveDir $filename
        if (Test-Path $sourcePath) {
            $newFilename = "${filename}_${Timestamp}"
            $destPath = Join-Path $HistoryDir $newFilename

            # Copy to history
            Copy-Item -Path $sourcePath -Destination $destPath -Force
            Write-Log -Level OK -Message "Saved to History: $filename -> $newFilename"
            $savedFiles += @{ Original = $filename; Saved = $newFilename }

            # Clear from active workspace
            Remove-Item -Path $sourcePath -Force
            Write-Log -Level INFO -Message "Cleared from Active: $filename"
        }
        else {
            Write-Log -Level SKIP -Message "Skipped (not found): $filename"
        }
    }

    # Update HISTORY_LOG.md
    $historyDate = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $historyEntry = @(
        "",
        "## History Entry",
        "- Date: $historyDate",
        "- Phase: $PhaseName",
        "- Timestamp: $Timestamp",
        "- Files Saved:"
    ) -join "`n"

    foreach ($file in $savedFiles) {
        $historyEntry += "`n  - $($file.Original) -> $($file.Saved)"
    }

    if (-not (Test-Path $HistoryLogFile)) {
        $logHeader = @(
            "# History Log",
            "",
            "Track all past workflow phases for historical reference and audit."
        ) -join "`n"
        Set-Content -Path $HistoryLogFile -Value $logHeader
    }

    Add-Content -Path $HistoryLogFile -Value $historyEntry

    Write-Log -Level OK -Message "Updated: HISTORY_LOG.md"
    Write-Host "=== HISTORY SAVE COMPLETE ===" -ForegroundColor Cyan

    return $savedFiles
}

function Get-FilesFromPlanTable {
    <#
    .SYNOPSIS
        Parse only the "## Files to Modify" markdown table from PLAN_APPROVED.md.
        Returns the list of file paths in the first column, skipping headers and
        separator rows. Avoids the previous regex bug that matched every cell.
    #>
    param([string]$PlanContent)

    $files = @()
    if ($PlanContent -notmatch '(?ms)^##\s+Files to Modify\s*\r?\n(.+?)(?=\r?\n##\s|\z)') {
        return $files
    }
    $section = $matches[1]
    foreach ($line in ($section -split "`r?`n")) {
        if ($line -match '^\s*\|\s*`?([^`|]+?)`?\s*\|') {
            $cell = $matches[1].Trim()
            if ($cell -eq '' -or $cell -match '^[-:]+$') { continue }       # separator
            if ($cell -ieq 'file' -or $cell -ieq 'files' -or $cell -ieq 'path') { continue } # header
            $files += $cell
        }
    }
    return $files
}

function Invoke-Snapshot {
    <#
    .SYNOPSIS
        Takes snapshots of files listed in PLAN_APPROVED.md before EXECUTION begins.
        Used by -Undo for file-level rollback. Stores a manifest.json so paths can
        be restored to their original locations (not just the project root).
    #>
    param([string]$State)

    if (-not (Test-Path $SnapshotsDir)) {
        New-Item -ItemType Directory -Path $SnapshotsDir -Force | Out-Null
    }

    $snapTimestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $cycleId = ""
    try {
        if (Test-Path $StatusFile) {
            $statusJson = Get-Content $StatusFile -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($statusJson.cycleId) { $cycleId = $statusJson.cycleId }
        }
    } catch { }
    $cycleSuffix = if ($cycleId) { "_${cycleId}" } else { "" }
    $snapDir = Join-Path $SnapshotsDir "${State}_${snapTimestamp}${cycleSuffix}"
    New-Item -ItemType Directory -Path $snapDir -Force | Out-Null

    $planPath = Join-Path $ActiveDir "PLAN_APPROVED.md"
    $manifest = @{
        snapshotState = $State
        cycleId       = $cycleId
        timestamp     = (Get-Date -Format "o")
        files         = @()
    }

    if (Test-Path $planPath) {
        $planContent = Get-Content $planPath -Raw
        $files = Get-FilesFromPlanTable -PlanContent $planContent

        $snapshotCount = 0
        foreach ($file in $files) {
            if (Test-Path $file) {
                # Preserve directory structure inside snapshot dir
                $destFile = Join-Path $snapDir $file
                $destParent = Split-Path $destFile -Parent
                if ($destParent -and -not (Test-Path $destParent)) {
                    New-Item -ItemType Directory -Path $destParent -Force | Out-Null
                }
                Copy-Item $file -Destination $destFile -Force
                $manifest.files += @{ original = $file; snapshot = $file }
                $snapshotCount++
            }
        }
        Write-Log -Level OK -Message "Snapshot: $snapshotCount file(s) saved to $snapDir"
    }

    # Always write manifest, even if empty, so Restore can detect a valid snapshot
    $manifest | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $snapDir "manifest.json") -Encoding UTF8

    return $snapDir
}

function Restore-Snapshot {
    <#
    .SYNOPSIS
        Restores files from the most recent snapshot, using the manifest to put each
        file back at its original path (not the project root). Falls back to leaf-only
        restoration for legacy snapshots without a manifest.
    #>
    if (-not (Test-Path $SnapshotsDir)) {
        Write-Log -Level INFO -Message "No snapshots directory found. Nothing to restore."
        return
    }

    $snapDirs = Get-ChildItem -Path $SnapshotsDir -Directory | Sort-Object Name -Descending
    if ($snapDirs.Count -eq 0) {
        Write-Log -Level INFO -Message "No snapshots to restore."
        return
    }

    # Prefer a snapshot whose cycleId matches current cycle, else most recent
    $currentCycleId = ""
    try {
        if (Test-Path $StatusFile) {
            $statusJson = Get-Content $StatusFile -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($statusJson.cycleId) { $currentCycleId = $statusJson.cycleId }
        }
    } catch { }

    $chosen = $null
    if ($currentCycleId) {
        $chosen = $snapDirs | Where-Object { $_.Name -like "*_${currentCycleId}" } | Select-Object -First 1
    }
    if (-not $chosen) { $chosen = $snapDirs[0] }

    $manifestPath = Join-Path $chosen.FullName "manifest.json"
    if (Test-Path $manifestPath) {
        try {
            $manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
            foreach ($entry in $manifest.files) {
                $src = Join-Path $chosen.FullName $entry.snapshot
                if (Test-Path $src) {
                    $destParent = Split-Path $entry.original -Parent
                    if ($destParent -and -not (Test-Path $destParent)) {
                        New-Item -ItemType Directory -Path $destParent -Force | Out-Null
                    }
                    Copy-Item $src -Destination $entry.original -Force
                    Write-Log -Level OK -Message "Restored: $($entry.original)"
                }
            }
            return
        } catch {
            Write-Log -Level WARN -Message "Snapshot manifest unreadable, falling back to leaf-only restore."
        }
    }

    # Legacy fallback (pre-manifest snapshots): copy by leaf name to project root
    $files = Get-ChildItem -Path $chosen.FullName -File | Where-Object { $_.Name -ne 'manifest.json' }
    foreach ($file in $files) {
        $restorePath = Join-Path (Resolve-Path .) $file.Name
        Copy-Item $file.FullName -Destination $restorePath -Force
        Write-Log -Level WARN -Message "Restored (leaf-only, original path unknown): $($file.Name)"
    }
}

# ============================================================================
# STATE TRANSITION ENGINE
# ============================================================================

function Invoke-StateTransition {
    $currentState = Get-CurrentState
    $statusData = Get-StatusData -State $currentState
    $config = $StateConfigs[$currentState]

    if ($currentState -eq "INIT") {
        Write-Host "`n=== ROO CODE WORKFLOW ORCHESTRATOR v3 ===" -ForegroundColor Cyan
        Write-Host "Starting new workflow cycle..." -ForegroundColor Green
        Invoke-ManifestCheck
        $newCycleId = [guid]::NewGuid().ToString().Substring(0,8)
        Write-StatusFile -State "PHASE_PLANNING" -PreviousState "INIT" -Phase "" -CycleStart (Get-Date -Format "o") -CycleId $newCycleId -TransitionCount 1
        $initConfig = $StateConfigs["PHASE_PLANNING"]
        Write-CurrentInstruction -State "PHASE_PLANNING" -ActiveMode $initConfig.ActiveMode -Instruction $initConfig.Instruction
        Write-Host "State: PHASE_PLANNING (cycle $newCycleId)" -ForegroundColor Yellow
        Write-Host "Next: Switch to Director mode and write PHASE_PLAN.md" -ForegroundColor White
        Invoke-GitCommit -FromState "INIT" -ToState "PHASE_PLANNING" -PhaseName "" -TransitionCount 1
        return
    }

    if ($currentState -eq "COMPLETE") {
        Write-Host "`nWorkflow is complete! No further transitions available." -ForegroundColor Green
        Write-Host "Use -Reset to start a new cycle." -ForegroundColor Gray
        return
    }

    # --- Run Pre-flight Gate 0 before EXECUTION ---
    if ($currentState -eq "PLAN_REVIEW") {
        # We're about to go to EXECUTION - check if the review says APPROVED
        $reviewFile = "$ActiveDir/PLAN_REVIEW.md"
        $goingToExecution = $false
        if (Test-Path $reviewFile) {
            $reviewContent = Get-Content $reviewFile -Raw
            if ($reviewContent -match "STATUS:.*APPROVED") {
                $goingToExecution = $true
            }
        }
        if ($goingToExecution) {
            Invoke-PreflightCheck
            # Take snapshot of files listed in PLAN_APPROVED.md
            Invoke-Snapshot -State "PRE_EXECUTION"
        }
    }

    # Validate quality gates before transition
    $outputFile = $config.OutputFile
    if ($outputFile) {
        $outputPath = "$ActiveDir/$outputFile"
        if (-not (Test-Path $outputPath)) {
            throw "Output file $outputPath not found. Cannot transition from $currentState."
        }

        # Programmatic content validation
        $fileContent = Get-Content $outputPath -Raw
        $gateNotes = ""

        switch ($currentState) {
            "PHASE_PLANNING" {
                # Gate 1: PHASE_PLAN.md must have at least one phase header
                if ($fileContent -notmatch '## Phase \d') {
                    throw "Quality Gate 1 FAILED: PHASE_PLAN.md must contain at least one '## Phase N:' section."
                }
                $gateNotes = "Phase headers found"
                Write-QualityGateResult -GateNumber 1 -GateName "Phase Plan Valid" -Passed $true -Notes $gateNotes
            }
            "DETAILED_PLANNING" {
                # Gate 2: DETAILED_PLAN.md must have BOTH Files to Modify AND Implementation Steps
                $missing = @()
                if ($fileContent -notmatch '(?m)^##\s+Files to Modify\b')   { $missing += 'Files to Modify' }
                if ($fileContent -notmatch '(?m)^##\s+Implementation Steps\b') { $missing += 'Implementation Steps' }
                if ($missing.Count -gt 0) {
                    throw "Quality Gate 2 FAILED: DETAILED_PLAN.md missing required sections: $($missing -join ', ')."
                }
                $gateNotes = "Required sections found"
                Write-QualityGateResult -GateNumber 2 -GateName "Detailed Plan Valid" -Passed $true -Notes $gateNotes
            }
            "PLAN_REVIEW" {
                # Gate 3: PLAN_REVIEW.md must have STATUS field
                if ($fileContent -notmatch 'STATUS:\s*(APPROVED|NEEDS_REVISION)') {
                    throw "Quality Gate 3 FAILED: PLAN_REVIEW.md must contain 'STATUS: APPROVED' or 'STATUS: NEEDS_REVISION'."
                }
                $gateNotes = "STATUS field present"
                Write-QualityGateResult -GateNumber 3 -GateName "Plan Review Valid" -Passed $true -Notes $gateNotes
            }
            "EXECUTION" {
                Test-ExecutionReportGate -Content $fileContent -ReportLabel 'EXECUTION_REPORT.md' -GateLabel '4' -GateName 'Execution Report Valid'
            }
            "EXECUTION_BACKEND" {
                Test-ExecutionReportGate -Content $fileContent -ReportLabel 'EXECUTION_REPORT_BACKEND.md' -GateLabel '4a' -GateName 'Backend Execution Report Valid'
            }
            "EXECUTION_FRONTEND" {
                Test-ExecutionReportGate -Content $fileContent -ReportLabel 'EXECUTION_REPORT_FRONTEND.md' -GateLabel '4b' -GateName 'Frontend Execution Report Valid'
            }
            "EXECUTION_REVIEW" {
                # Gate 5: EXECUTION_REVIEW.md must have STATUS field
                if ($fileContent -notmatch 'STATUS:\s*(APPROVED|NEEDS_REVISION)') {
                    throw "Quality Gate 5 FAILED: EXECUTION_REVIEW.md must contain 'STATUS: APPROVED' or 'STATUS: NEEDS_REVISION'."
                }
                $gateNotes = "STATUS field present"
                Write-QualityGateResult -GateNumber 5 -GateName "Execution Review Valid" -Passed $true -Notes $gateNotes
            }
        }
    }

    # Determine next state
    $nextState = $config.NextState

    # Handle approval/revision branching
    if ($currentState -in @("PLAN_REVIEW", "EXECUTION_REVIEW")) {
        $reviewFile = if ($currentState -eq "PLAN_REVIEW") { "$ActiveDir/PLAN_REVIEW.md" } else { "$ActiveDir/EXECUTION_REVIEW.md" }

        if (Test-Path $reviewFile) {
            $reviewContent = Get-Content $reviewFile -Raw
            if ($reviewContent -match "STATUS:.*NEEDS_REVISION") {
                $nextState = $config.AltNextState
                $newRetryCount = [int]$statusData["Retry Count"] + 1
                $statusData["Retry Count"] = $newRetryCount

                # A13: hard-enforce the 5-strike rule. Above the limit -> BLOCKED, write ESCALATION.md.
                $maxRetries = 5
                if ($newRetryCount -ge $maxRetries) {
                    $escalationPath = Join-Path $ActiveDir "ESCALATION.md"
                    $nl = [Environment]::NewLine
                    $escalationContent = (
                        "# Escalation - Workflow BLOCKED",
                        "",
                        "**Triggered at:** $(Get-Date -Format 'o')",
                        "**State:** $currentState",
                        "**Phase:** $($statusData['Phase'])",
                        "**Cycle Id:** $($statusData['Cycle Id'])",
                        "**Retry Count:** $newRetryCount (limit: $maxRetries)",
                        "",
                        "The 5-strike retry limit was reached. The workflow is now BLOCKED.",
                        "",
                        "## What to do",
                        "",
                        "1. Investigate the root cause manually.",
                        "2. Update WORKFLOW/LESSONS_LEARNED.md with the lesson learned.",
                        "3. Run ``.\orchestrator.ps1 -Resume`` to reset RetryCount and re-enter EXECUTION,",
                        "   or ``.\orchestrator.ps1 -Undo`` / ``-Reset`` to roll back."
                    ) -join $nl
                    Set-Content -Path $escalationPath -Value $escalationContent -Encoding UTF8

                    Write-StatusFile -State $currentState `
                        -PreviousState $statusData["Previous State"] `
                        -Phase $statusData["Phase"] `
                        -CycleStart $statusData["Cycle Start"] `
                        -CycleId $statusData["Cycle Id"] `
                        -LastTransition (Get-Date -Format "o") `
                        -TransitionCount ([int]$statusData["Transition Count"]) `
                        -RetryCount $newRetryCount `
                        -NextAction "Workflow BLOCKED at 5-strike limit. See WORKFLOW/ACTIVE/ESCALATION.md." `
                        -NextMode "" `
                        -Status "BLOCKED" `
                        -BlockedReason "Retry limit reached at $currentState (max $maxRetries)."

                    Write-CurrentInstruction -State $currentState -ActiveMode "" -Instruction "Workflow BLOCKED at 5-strike limit. Read WORKFLOW/ACTIVE/ESCALATION.md, fix the root cause manually, then run ``.\orchestrator.ps1 -Resume``."

                    Send-WebhookNotification -State $currentState -Phase $statusData["Phase"] -Status "BLOCKED" -Message "5-strike retry limit reached. See ESCALATION.md."

                    throw "5-strike limit reached at $currentState. Workflow BLOCKED. See WORKFLOW/ACTIVE/ESCALATION.md."
                }

                if ($currentState -eq "PLAN_REVIEW") {
                    Write-Host "`nPlan needs revision (retry $newRetryCount/$maxRetries). Returning to Planner." -ForegroundColor Yellow
                }
                else {
                    Write-Host "`nExecution needs revision (retry $newRetryCount/$maxRetries). Returning to Executor." -ForegroundColor Yellow
                }
            }
            elseif ($reviewContent -match "STATUS:.*APPROVED") {
                if ($currentState -eq "EXECUTION_REVIEW") {
                    $nextState = "ARCHIVE"
                }
                elseif ($currentState -eq "PLAN_REVIEW") {
                    # Check for parallel tracks (monorepo: backend + frontend)
                    $parallelTracks = $false
                    try {
                        $statusJson = Get-Content $StatusFile -Raw -Encoding UTF8 | ConvertFrom-Json
                        $parallelTracks = if ($statusJson.parallelTracks) { $true } else { $false }
                    } catch { }
                    if ($parallelTracks) {
                        $nextState = "EXECUTION_BACKEND"
                        Write-Host "`nParallel tracks enabled: EXECUTION will run twice (BACKEND -> FRONTEND)" -ForegroundColor Cyan
                    }
                }
            }
        }
    }

    # Handle ARCHIVE -> COMPLETE transition: auto-save to history
    if ($currentState -eq "ARCHIVE" -and $nextState -eq "COMPLETE") {
        Write-Host "`n=== PROCESSING ARCHIVE -> COMPLETE TRANSITION ===" -ForegroundColor Cyan

        # Ensure HISTORY dir exists
        if (-not (Test-Path $HistoryDir)) {
            New-Item -ItemType Directory -Path $HistoryDir -Force | Out-Null
        }

        $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
        $phaseName = $statusData["Phase"]

        if ([string]::IsNullOrWhiteSpace($phaseName)) {
            $phaseName = "Unnamed Phase"
        }

        # --- DNA Auto-Snapshot (Phase 2.4) ---
        Invoke-DnaAutoSnapshot -PhaseName $phaseName

        # --- Archive files ---
        Invoke-ArchiveFiles -PhaseName $phaseName -Timestamp $timestamp

        # --- Collect real metric inputs (A8) ---

        # FilesModified from git diff --stat between cycle start commit and HEAD
        $filesModified = 0
        try {
            $startCommitFile = "$WorkflowDir/.execution_start_commit"
            if (Test-Path $startCommitFile) {
                $startCommit = (Get-Content $startCommitFile).Trim()
                $diffOutput = & git diff --name-only $startCommit HEAD 2>$null
                if ($LASTEXITCODE -eq 0 -and $diffOutput) {
                    $filesModified = ($diffOutput | Where-Object { $_ -ne '' }).Count
                }
            }
        } catch { }

        # GateResults: the most recent N gate rows from QUALITY_DASHBOARD.md, just for this cycle
        $gateResults = @()
        try {
            if (Test-Path $DashboardFile) {
                $cycleStartIso = $statusData["Cycle Start"]
                $cycleStartDt = $null
                if ($cycleStartIso) { try { $cycleStartDt = [DateTime]::Parse($cycleStartIso) } catch { } }
                $sep = [char]0x7C
                $rows = Get-Content $DashboardFile | Where-Object { $_.StartsWith("$sep ") -and $_ -notmatch '\bGate\s*\|\s*Result\b' -and $_ -notmatch '^\|\s*-' }
                foreach ($row in $rows) {
                    $cols = ($row -split [regex]::Escape($sep)) | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }
                    if ($cols.Count -ge 3) {
                        $rowTs = $null
                        try { $rowTs = [DateTime]::Parse($cols[0]) } catch { }
                        if (-not $cycleStartDt -or ($rowTs -and $rowTs -ge $cycleStartDt)) {
                            $notesVal = if ($cols.Count -ge 4) { $cols[3] } else { '' }
                            $gateResults += @{ timestamp = $cols[0]; gate = $cols[1]; result = $cols[2]; notes = $notesVal }
                        }
                    }
                }
            }
        } catch { }

        # Retries: simply the final retry count (no per-error breakdown without deeper tracking)
        $retriesMap = @{ total = [int]$statusData["Retry Count"] }

        # --- Record metrics ---
        Invoke-AppendMetrics -PhaseName $phaseName `
            -CycleId $statusData["Cycle Id"] `
            -StartTime $statusData["Cycle Start"] `
            -EndTime (Get-Date -Format "o") `
            -Transitions ([int]$statusData["Transition Count"]) `
            -Retries $retriesMap `
            -GateResults $gateResults `
            -FilesModified $filesModified `
            -Escalated $false

        # --- A16: clean execution-start commit pointer for the next cycle ---
        if (Test-Path "$WorkflowDir/.execution_start_commit") {
            Remove-Item "$WorkflowDir/.execution_start_commit" -Force -ErrorAction SilentlyContinue
        }

        # --- Webhook notification ---
        Send-WebhookNotification -State "COMPLETE" -Phase $phaseName -Status "COMPLETE" -Message "Workflow cycle completed successfully."
    }

    # --- Multi-phase auto-advance: pop the next phase off PHASE_QUEUE.json -------
    # When a reconciler-generated queue exists, ARCHIVE -> COMPLETE re-routes
    # back into PHASE_PLANNING with the next phase's content pre-loaded.
    # Failure to read/parse the queue degrades gracefully: cycle ends terminal.
    $phaseIndex = 0
    $phaseTotal = 0
    $queuePath = Join-Path $WorkflowDir 'PHASE_QUEUE.json'
    if ($currentState -eq "ARCHIVE" -and $nextState -eq "COMPLETE" -and (Test-Path $queuePath)) {
        try {
            $queue = Get-Content $queuePath -Raw -Encoding UTF8 | ConvertFrom-Json
            $cursor = if ($queue.PSObject.Properties.Match('cursor').Count -gt 0) { [int]$queue.cursor } else { 0 }
            $cycles = $queue.cycles
            $totalCycles = if ($cycles) { @($cycles).Count } else { 0 }
            $nextCursor = $cursor + 1

            if ($totalCycles -gt 0 -and $nextCursor -lt $totalCycles) {
                $next = $cycles[$nextCursor]
                $nextTitle = if ($next.title) { [string]$next.title } else { "Phase $($next.number)" }
                $nextBody  = if ($next.body)  { [string]$next.body  } else { '' }
                $projectName = if ($queue.PSObject.Properties.Match('projectName').Count -gt 0) { [string]$queue.projectName } else { 'Untitled Project' }

                # Pre-populate ACTIVE/PHASE_PLAN.md with the queued phase's content.
                $newPhasePlan = @"
# Phase Plan -- $projectName

## Phase $($next.number): $nextTitle

$nextBody

---

_Auto-loaded from WORKFLOW/PHASE_QUEUE.json (cursor=$nextCursor of $totalCycles). Director should refine and confirm before -Next._
"@
                Set-Content -Path (Join-Path $ActiveDir 'PHASE_PLAN.md') -Value $newPhasePlan -Encoding UTF8

                # Advance the queue cursor (atomic).
                $queue.cursor = $nextCursor
                Invoke-AtomicJsonWrite -Path $queuePath -JsonContent ($queue | ConvertTo-Json -Depth 6)

                # Re-route to PHASE_PLANNING instead of terminal COMPLETE.
                $nextState = "PHASE_PLANNING"
                $phaseIndex = $nextCursor + 1
                $phaseTotal = $totalCycles

                Write-Host "`n=== PHASE QUEUE: ADVANCING TO PHASE $phaseIndex of $phaseTotal ===" -ForegroundColor Cyan
                Write-Host "Title: $nextTitle" -ForegroundColor Yellow
            } else {
                # Queue exhausted -- clean up and let cycle end terminally.
                Remove-Item $queuePath -Force -ErrorAction SilentlyContinue
                Write-Log -Level INFO -Message "PHASE_QUEUE.json exhausted ($totalCycles cycles complete) -- workflow terminates."
            }
        } catch {
            Write-Log -Level WARN -Message "Could not parse PHASE_QUEUE.json -- cycle terminating normally. ($_)"
        }
    } elseif ((Test-Path $queuePath) -and $nextState -eq "COMPLETE") {
        # Cursor metadata for status display even on intermediate transitions.
        try {
            $queue = Get-Content $queuePath -Raw -Encoding UTF8 | ConvertFrom-Json
            $cursor = if ($queue.PSObject.Properties.Match('cursor').Count -gt 0) { [int]$queue.cursor } else { 0 }
            $totalCycles = if ($queue.cycles) { @($queue.cycles).Count } else { 0 }
            $phaseIndex = $cursor + 1
            $phaseTotal = $totalCycles
        } catch { }
    }

    $transitionCount = [int]$statusData["Transition Count"] + 1
    $nextConfig = $StateConfigs[$nextState]

    $newStatus = if ($nextState -eq "COMPLETE") { "COMPLETE" } else { "IN_PROGRESS" }

    $statusFileArgs = @{
        State            = $nextState
        PreviousState    = $currentState
        Phase            = $statusData["Phase"]
        CycleStart       = $statusData["Cycle Start"]
        CycleId          = $statusData["Cycle Id"]
        LastTransition   = (Get-Date -Format "o")
        TransitionCount  = $transitionCount
        RetryCount       = $statusData["Retry Count"]
        NextAction       = $nextConfig.Instruction
        NextMode         = $nextConfig.ActiveMode
        Status           = $newStatus
    }
    if ($phaseIndex -gt 0) { $statusFileArgs.PhaseIndex = $phaseIndex }
    if ($phaseTotal -gt 0) { $statusFileArgs.PhaseTotal = $phaseTotal }
    Write-StatusFile @statusFileArgs

    # Tickle file: fresh "what to do now" prompt for the next agent turn.
    # Read by ContextInjector for every mode + by roo-code.resumeWorkflow.
    Write-CurrentInstruction -State $nextState -ActiveMode $nextConfig.ActiveMode -Instruction $nextConfig.Instruction

    # --- Diff-based Code Review (Phase 5d) ---
    if ($currentState -match "^EXECUTION" -and $nextState -eq "EXECUTION_REVIEW") {
        Write-Log -Level INFO -Message "Generating EXECUTION_DIFF.diff..."
        try {
            if (Test-Path "$WorkflowDir/.execution_start_commit") {
                $startCommit = (Get-Content "$WorkflowDir/.execution_start_commit").Trim()
                & git diff $startCommit > "$ActiveDir/EXECUTION_DIFF.diff"
                Write-Log -Level OK -Message "Saved diff against $startCommit to EXECUTION_DIFF.diff"
            } else {
                Write-Log -Level WARN -Message "No .execution_start_commit found, skipping diff."
            }
        } catch {
            Write-Log -Level WARN -Message "Failed to generate execution diff: $_"
        }
    }

    # Record the start of execution phases
    if ($nextState -match "^EXECUTION" -and $currentState -notmatch "^EXECUTION") {
        try {
            & git rev-parse HEAD > "$WorkflowDir/.execution_start_commit"
        } catch { }
    }

    # --- Git commit after every successful transition ---
    $phaseName = $statusData["Phase"]
    if ([string]::IsNullOrWhiteSpace($phaseName)) { $phaseName = "Unnamed" }
    Invoke-GitCommit -FromState $currentState -ToState $nextState -PhaseName $phaseName -TransitionCount $transitionCount

    # --- Webhook notification on BLOCKED state ---
    if ($newStatus -eq "BLOCKED" -or $statusData["Status"] -eq "BLOCKED") {
        Send-WebhookNotification -State $currentState -Phase $statusData["Phase"] -Status "BLOCKED" -Message $statusData["Blocked Reason"]
    }

    Write-Host "`n=== STATE TRANSITION ===" -ForegroundColor Cyan
    Write-Host "From: $currentState" -ForegroundColor Gray
    Write-Host "To:   $nextState" -ForegroundColor Yellow

    # Display the mode that should ACT on the new state (its ActiveMode), NOT
    # the legacy `NextMode` field which is the alternate-path mode used only
    # when a review returns NEEDS_REVISION. Showing the wrong one (e.g.
    # "PLANNER" right after entering PLAN_REVIEW) confuses agents into running
    # `-Next` again instead of doing the Director's review work.
    if ($nextConfig.ActiveMode) {
        Write-Host "`nACTIVE MODE: $($nextConfig.ActiveMode.ToUpper())" -ForegroundColor Green
    }
    Write-Host "`nINSTRUCTION: $($nextConfig.Instruction)" -ForegroundColor White
}

function Invoke-DnaAutoSnapshot {
    <#
    .SYNOPSIS
        Auto-appends version and file info to PHASE_DNA.md during ARCHIVE -> COMPLETE.
    #>
    param([string]$PhaseName)

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $snapshotLines = @()

    # Read modified files from EXECUTION_REPORT.md (only the "## Files Modified" table)
    $reportPath = Join-Path $ActiveDir "EXECUTION_REPORT.md"
    if (Test-Path $reportPath) {
        $reportContent = Get-Content $reportPath -Raw
        $files = @()
        if ($reportContent -match '(?ms)^##\s+Files Modified\s*\r?\n(.+?)(?=\r?\n##\s|\z)') {
            $section = $matches[1]
            foreach ($line in ($section -split "`r?`n")) {
                if ($line -match '^\s*\|\s*`?([^`|]+?)`?\s*\|') {
                    $cell = $matches[1].Trim()
                    if ($cell -eq '' -or $cell -match '^[-:]+$') { continue }
                    if ($cell -ieq 'file' -or $cell -ieq 'files' -or $cell -ieq 'path') { continue }
                    $files += $cell
                }
            }
        }
        if ($files.Count -gt 0) {
            $snapshotLines += "- **Files Modified:** $($files -join ', ')"
        }
    }

    # Detect stack versions
    if (Test-Path "artisan") {
        try {
            $laravelVer = & php artisan --version 2>$null
            $snapshotLines += "- **Laravel Version:** $laravelVer"
        }
        catch { }
    }
    if (Test-Path "pubspec.yaml") {
        try {
            $flutterVer = & flutter --version 2>$null | Select-Object -First 1
            $snapshotLines += "- **Flutter Version:** $flutterVer"
        }
        catch { }
    }
    if (Test-Path "package.json") {
        try {
            $nodeVer = node --version 2>$null
            $snapshotLines += "- **Node Version:** $nodeVer"
        }
        catch { }
    }

    if ($snapshotLines.Count -gt 0) {
        $snapshot = @"

## Auto-Snapshot - $timestamp
- **Phase:** $PhaseName
$($snapshotLines -join "`n")
"@
        Add-Content -Path $PhaseDNAFile -Value $snapshot
        Write-Log -Level OK -Message "DNA auto-snapshot appended to PHASE_DNA.md"
    }
}

function Invoke-AppendMetrics {
    <#
    .SYNOPSIS
        Records a completed cycle to METRICS.json for cross-cycle analytics.
        Called during ARCHIVE -> COMPLETE transition.
    #>
    param(
        [string]$PhaseName,
        [string]$CycleId = "",
        [string]$StartTime,
        [string]$EndTime,
        [int]$Transitions,
        [hashtable]$Retries,
        [array]$GateResults,
        [int]$FilesModified,
        [bool]$Escalated
    )

    if (-not (Test-Path $MetricsFile)) {
        $initialMetrics = @{ cycles = @() } | ConvertTo-Json -Depth 3
        Set-Content -Path $MetricsFile -Value $initialMetrics -Encoding UTF8
    }

    try {
        $metrics = Get-Content $MetricsFile -Raw -Encoding UTF8 | ConvertFrom-Json
        $duration = if ($StartTime -and $EndTime) {
            try {
                $start = [DateTime]::Parse($StartTime)
                $end = [DateTime]::Parse($EndTime)
                [math]::Round(($end - $start).TotalMinutes)
            } catch { 0 }
        } else { 0 }

        $cycle = @{
            cycleId         = $CycleId
            phase           = $PhaseName
            startTime       = $StartTime
            endTime         = $EndTime
            durationMinutes = $duration
            transitions     = $Transitions
            retries         = $Retries
            gateResults     = $GateResults
            filesModified   = $FilesModified
            escalated       = $Escalated
        }

        # ConvertFrom-Json returns PSCustomObjects whose .cycles property may be a fixed array;
        # convert to an arraylist before appending to avoid "collection was of a fixed size".
        $existingCycles = @()
        if ($metrics.cycles) { $existingCycles = @($metrics.cycles) }
        $existingCycles += $cycle
        $newMetrics = @{ cycles = $existingCycles }
        $newMetrics | ConvertTo-Json -Depth 6 | Set-Content $MetricsFile -Encoding UTF8
        Write-Log -Level OK -Message "Metrics: Cycle recorded - ${PhaseName} (${duration} min, ${Transitions} transitions, ${FilesModified} files)"
    }
    catch {
        Write-Log -Level WARN -Message "Metrics: could not update METRICS.json: $_"
    }
}

function Send-WebhookNotification {
    <#
    .SYNOPSIS
        Sends a webhook notification for workflow events.
        Supports Slack, Discord, and generic webhook formats.
        Webhook URL read from ROO_WEBHOOK_URL environment variable.
    #>
    param(
        [string]$State,
        [string]$Phase,
        [string]$Status,
        [string]$Message
    )

    $webhookUrl = $env:ROO_WEBHOOK_URL
    if (-not $webhookUrl) {
        return  # No webhook configured - silently skip
    }

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $payload = @{
        text = @"
[Roo Workflow]
State: *$State*
Phase: *$Phase*
Status: *$Status*
Message: $Message
Timestamp: $timestamp
"@
    } | ConvertTo-Json

    try {
        $response = Invoke-RestMethod -Uri $webhookUrl -Method Post -Body $payload -ContentType "application/json" -ErrorAction SilentlyContinue
        Write-Log -Level OK -Message "Webhook notification sent"
    }
    catch {
        Write-Log -Level WARN -Message "Webhook failed to send: $_"
    }
}

# ============================================================================
# STATUS DISPLAY
# ============================================================================

function Show-Status {
    $currentState = Get-CurrentState
    $statusData = Get-StatusData -State $currentState
    $config = $StateConfigs[$currentState]

    Write-Host "`n=== ROO CODE WORKFLOW STATUS ===" -ForegroundColor Cyan
    
    # --- ASCII Art Pipeline (Phase 6a) ---
    $allStates = @("INIT","PHASE_PLANNING","DETAILED_PLANNING","PLAN_REVIEW","EXECUTION","EXECUTION_REVIEW","ARCHIVE","COMPLETE")
    $idx = $allStates.IndexOf($currentState)
    if ($idx -lt 0) { $idx = $allStates.IndexOf("EXECUTION") } # fallback for parallel tracks
    
    Write-Host "`nPipeline:" -ForegroundColor Gray
    $pipelineLines = @()
    for ($i=0; $i -lt $allStates.Count; $i++) {
        $s = $allStates[$i]
        $prefix = "  "
        $color = "Gray"
        if ($i -lt $idx) {
            $prefix = "[v] "
            $color = "Green"
        } elseif ($i -eq $idx) {
            $prefix = "[>] "
            $color = "Yellow"
        } else {
            $prefix = "[ ] "
            $color = "DarkGray"
        }
        
        $stateName = $s
        if ($i -eq $idx -and $currentState -match "^EXECUTION_") {
            $stateName = $currentState # Show exact track if parallel
        }
        
        Write-Host "$prefix$stateName " -NoNewline -ForegroundColor $color
        if ($i -lt $allStates.Count - 1) {
            Write-Host "- " -NoNewline -ForegroundColor DarkGray
        }
    }
    Write-Host "`n"

    Write-Host "Current State: $currentState" -ForegroundColor Yellow
    Write-Host "Phase: $($statusData['Phase'])" -ForegroundColor White

    if ($statusData["Cycle Start"]) {
        Write-Host "Cycle Start: $($statusData['Cycle Start'])" -ForegroundColor Gray
        try {
            $startTime = [DateTime]::Parse($statusData["Cycle Start"])
            $elapsed = (Get-Date) - $startTime
            Write-Host "Elapsed: $($elapsed.ToString('hh\:mm\:ss'))" -ForegroundColor Gray
        }
        catch {
            Write-Host "Elapsed: unable to calculate" -ForegroundColor Gray
        }
    }

    Write-Host "Status: $($statusData['Status'])" -ForegroundColor $(if ($statusData['Status'] -eq 'BLOCKED') { 'Red' } elseif ($statusData['Status'] -eq 'COMPLETE') { 'Green' } else { 'Yellow' })

    if ($statusData["Blocked Reason"]) {
        Write-Host "Blocked Reason: $($statusData['Blocked Reason'])" -ForegroundColor Red
    }

    Write-Host "`nTransition Count: $($statusData['Transition Count'])" -ForegroundColor Gray
    Write-Host "Retry Count: $($statusData['Retry Count'])" -ForegroundColor Gray

    if ($config.ActiveMode) {
        Write-Host "`nNext Mode: $($config.ActiveMode.ToUpper())" -ForegroundColor Green
    }
    Write-Host "Next Action: $($config.Instruction)" -ForegroundColor White

    if ($currentState -ne "INIT" -and $currentState -ne "COMPLETE") {
        $outputFile = $config.OutputFile
        if ($outputFile) {
            $outputPath = "$ActiveDir/$outputFile"
            $exists = Test-Path $outputPath
            Write-Host "`nExpected Output: $outputFile" -ForegroundColor $(if ($exists) { 'Green' } else { 'Red' })
            Write-Host "  Exists: $exists" -ForegroundColor $(if ($exists) { 'Green' } else { 'Red' })
        }
    }

    if ($currentState -eq "COMPLETE") {
        Write-Host "`nWORKFLOW COMPLETE!" -ForegroundColor Green
        Write-Host "All files archived and learning system updated." -ForegroundColor White
    }

    # Show manifest info
    Invoke-ManifestCheck
}

# ============================================================================
# INTERACTIVE PLAN WIZARD
# ============================================================================

function Invoke-PlanWizard {
    <#
    .SYNOPSIS
        Interactive guided wizard for creating a feature request.
        Generates a starter PHASE_PLAN.md and transitions to PHASE_PLANNING.
    #>
    Write-Host "`n=== ROO WORKFLOW PLAN WIZARD ===" -ForegroundColor Cyan
    Write-Host "This wizard will help you create a structured feature request.`n" -ForegroundColor White

    $feature = ""
    while ([string]::IsNullOrWhiteSpace($feature)) {
        $feature = Read-Host "What feature are you building?"
    }

    # --- Auto-Detect Stack ---
    $hasLaravel = Test-Path "artisan"
    $hasFlutter = Test-Path "pubspec.yaml"
    $hasNode = Test-Path "package.json"
    
    $detectedStack = "Unknown"
    $detectedChoice = "1"
    if ($hasLaravel -and $hasFlutter) { $detectedStack = "Laravel+Flutter Monorepo"; $detectedChoice = "3" }
    elseif ($hasLaravel) { $detectedStack = "Laravel / PHP"; $detectedChoice = "1" }
    elseif ($hasFlutter) { $detectedStack = "Flutter / Dart"; $detectedChoice = "2" }
    elseif ($hasNode) { $detectedStack = "Node.js / TS"; $detectedChoice = "4" }

    $stackChoice = ""
    $stack = ""

    if ($detectedStack -ne "Unknown") {
        Write-Host "`nAuto-detected stack: $detectedStack" -ForegroundColor Green
        $confirm = Read-Host "Use this stack? [Y/n]"
        if ($confirm -eq '' -or $confirm.ToLower() -eq 'y') {
            $stackChoice = $detectedChoice
            $stack = $detectedStack
        }
    }

    if ([string]::IsNullOrWhiteSpace($stackChoice)) {
        Write-Host "`nStack selection:" -ForegroundColor Yellow
        Write-Host '  1) Laravel / PHP only' -ForegroundColor Gray
        Write-Host '  2) Flutter / Dart only' -ForegroundColor Gray
        Write-Host '  3) Both (Laravel+Flutter Monorepo)' -ForegroundColor Gray
        Write-Host '  4) Node.js / TypeScript' -ForegroundColor Gray
        while ($stackChoice -notin @("1","2","3","4")) {
            $stackChoice = Read-Host "Choice [1/2/3/4]"
        }
        $stackMap = @{ "1" = "Laravel"; "2" = "Flutter"; "3" = "Laravel+Flutter"; "4" = "Node.js / TS" }
        $stack = $stackMap[$stackChoice]
    }

    Write-Host "`nComplexity:" -ForegroundColor Yellow
    Write-Host '  1) Small (<5 files)' -ForegroundColor Gray
    Write-Host '  2) Medium (5-15 files)' -ForegroundColor Gray
    Write-Host '  3) Large (15+ files)' -ForegroundColor Gray
    $complexityChoice = ""
    while ($complexityChoice -notin @("1","2","3")) {
        $complexityChoice = Read-Host "Choice [1/2/3]"
    }
    $complexityMap = @{ "1" = "Small"; "2" = "Medium"; "3" = "Large" }
    $complexity = $complexityMap[$complexityChoice]

    Write-Host "`nGenerating plan skeleton..." -ForegroundColor Yellow

    # Create PHASE_PLAN.md
    $phasePlan = @"
# Phase Plan

## Feature
$feature

## Stack
$stack

## Complexity
$complexity

---

## Phase 1: Implementation
**Goal:** Implement $feature
**Scope:** $stack project - $complexity change
**Dependencies:** None
**Success Criteria:**
- Feature $feature is functional
- All tests pass
- Code follows project conventions
"@

    # Ensure directory exists
    if (-not (Test-Path $ActiveDir)) {
        New-Item -ItemType Directory -Path $ActiveDir -Force | Out-Null
    }

    Set-Content -Path (Join-Path $ActiveDir "PHASE_PLAN.md") -Value $phasePlan -Encoding UTF8
    Write-Host "  CREATED: WORKFLOW/ACTIVE/PHASE_PLAN.md" -ForegroundColor Green

    # Set parallel tracks if monorepo
    $parallel = ($stackChoice -eq "3")

    # Update status file
    $now = Get-Date -Format "o"
    $newCycleId = [guid]::NewGuid().ToString().Substring(0,8)
    Write-StatusFile -State "PHASE_PLANNING" `
        -PreviousState "INIT" `
        -Phase $feature `
        -CycleStart $now `
        -CycleId $newCycleId `
        -LastTransition $now `
        -TransitionCount 1 `
        -RetryCount 0 `
        -NextAction $StateConfigs["PHASE_PLANNING"].Instruction `
        -NextMode $StateConfigs["PHASE_PLANNING"].ActiveMode `
        -Status "IN_PROGRESS" `
        -Autopilot $false

    Write-CurrentInstruction -State "PHASE_PLANNING" -ActiveMode $StateConfigs["PHASE_PLANNING"].ActiveMode -Instruction $StateConfigs["PHASE_PLANNING"].Instruction

    # Enable parallel tracks in status JSON if monorepo
    if ($parallel) {
        try {
            $statusJson = Get-Content $StatusFile -Raw -Encoding UTF8 | ConvertFrom-Json
            $statusJson.parallelTracks = $true
            $statusJson | ConvertTo-Json -Depth 3 | Set-Content $StatusFile -Encoding UTF8
        } catch {
            Write-Host "  WARN: Could not set parallelTracks flag." -ForegroundColor Yellow
        }
    }

    Write-Host "`n=== WIZARD COMPLETE ===" -ForegroundColor Cyan
    Write-Host "Plan skeleton created for: $feature" -ForegroundColor Green
    Write-Host "Stack: $stack | Complexity: $complexity" -ForegroundColor Gray
    if ($parallel) {
        Write-Host "Parallel tracks: TRUE (monorepo detected)" -ForegroundColor Yellow
    }
    Write-Host "`nNow switch to Director mode and refine the plan in PHASE_PLAN.md" -ForegroundColor White
    Write-Host "Then run: orchestrator.ps1 -Next" -ForegroundColor Gray
}

function Invoke-ResetWorkflow {
    Write-Host "`nResetting workflow to INIT state..." -ForegroundColor Yellow
    Write-StatusFile -State "INIT" -Status "IN_PROGRESS"
    Write-CurrentInstruction -State "INIT" -ActiveMode "" -Instruction "Workflow has been reset. Provide a feature request or run -Plan to start a new cycle."

    # Clean ACTIVE directory of stale files (keep QUALITY_GATES.md)
    if (Test-Path $ActiveDir) {
        $staleFiles = Get-ChildItem -Path $ActiveDir -File | Where-Object { $_.Name -ne "QUALITY_GATES.md" }
        $removedCount = 0
        foreach ($file in $staleFiles) {
            Remove-Item -Path $file.FullName -Force
            Write-Log -Level INFO -Message "Removed stale file: $($file.Name)"
            $removedCount++
        }
        if ($removedCount -gt 0) {
            Write-Log -Level WARN -Message "Cleaned $removedCount stale file(s) from ACTIVE/"
        } else {
            Write-Log -Level INFO -Message "ACTIVE/ directory is already clean."
        }
    }

    # Clean SNAPSHOTS directory
    if (Test-Path $SnapshotsDir) {
        Remove-Item -Path $SnapshotsDir -Recurse -Force
        Write-Log -Level WARN -Message "Cleaned SNAPSHOTS/ directory."
    }

    # A16: clean stale execution-start commit pointer so next cycle's diff is clean
    if (Test-Path "$WorkflowDir/.execution_start_commit") {
        Remove-Item "$WorkflowDir/.execution_start_commit" -Force -ErrorAction SilentlyContinue
        Write-Log -Level INFO -Message "Cleaned .execution_start_commit"
    }

    Write-Log -Level OK -Message "Workflow reset complete. Use -Next to begin."
}

function Invoke-UndoTransition {
    $currentState = Get-CurrentState
    $statusData = Get-StatusData -State $currentState
    $prevState = $statusData["Previous State"]

    if ($currentState -eq "INIT") {
        Write-Host "Already at INIT state. Nothing to undo." -ForegroundColor Yellow
    }
    elseif ([string]::IsNullOrWhiteSpace($prevState)) {
        Write-Host "No previous state recorded. Cannot undo." -ForegroundColor Red
    }
    else {
        $prevConfig = $StateConfigs[$prevState]
        $transitionCount = [int]$statusData["Transition Count"]
        if ($transitionCount -gt 0) { $transitionCount-- }

        Write-StatusFile -State $prevState `
            -PreviousState "" `
            -Phase $statusData["Phase"] `
            -CycleStart $statusData["Cycle Start"] `
            -CycleId $statusData["Cycle Id"] `
            -LastTransition (Get-Date -Format "o") `
            -TransitionCount $transitionCount `
            -RetryCount $statusData["Retry Count"] `
            -NextAction $prevConfig.Instruction `
            -NextMode $prevConfig.ActiveMode `
            -Status "IN_PROGRESS"

        Write-CurrentInstruction -State $prevState -ActiveMode $prevConfig.ActiveMode -Instruction $prevConfig.Instruction

        Write-Host "`n=== STATE ROLLBACK ===" -ForegroundColor Magenta
        Write-Host "From: $currentState" -ForegroundColor Gray
        Write-Host "Back to: $prevState" -ForegroundColor Yellow
        Write-Host "Transition count: $transitionCount" -ForegroundColor Gray

        # Offer file restoration from snapshot
        if (Test-Path $SnapshotsDir) {
            Write-Host "`nFile snapshots available. Restore files from snapshot?" -ForegroundColor Yellow
            $restore = Read-Host "Restore files? (y/N)"
            if ($restore -eq 'y' -or $restore -eq 'Y') {
                Restore-Snapshot
            }
        }
    }
}

function Invoke-ResumeExecution {
    $currentState = Get-CurrentState
    if ($currentState -ne "EXECUTION") {
        Write-Host "Resume can only be used when state is EXECUTION. Current: $currentState" -ForegroundColor Red
    }
    else {
        $statusData = Get-StatusData
        $config = $StateConfigs["EXECUTION"]

        Write-StatusFile -State "EXECUTION" `
            -PreviousState $statusData["Previous State"] `
            -Phase $statusData["Phase"] `
            -CycleStart $statusData["Cycle Start"] `
            -CycleId $statusData["Cycle Id"] `
            -LastTransition (Get-Date -Format "o") `
            -TransitionCount ([int]$statusData["Transition Count"]) `
            -RetryCount 0 `
            -NextAction $config.Instruction `
            -NextMode $config.ActiveMode `
            -Status "IN_PROGRESS"

        Write-CurrentInstruction -State "EXECUTION" -ActiveMode $config.ActiveMode -Instruction $config.Instruction

        Write-Host "`n=== RESUME ===" -ForegroundColor Cyan
        Write-Host "RetryCount reset to 0. EXECUTION state maintained." -ForegroundColor Green
        Write-Host "Next: $($config.Instruction)" -ForegroundColor White
    }
}

function Invoke-InteractiveRepl {
    Write-Host "`n=== INTERACTIVE MODE ===" -ForegroundColor Cyan
    Write-Host "Commands: next, status, reset, undo, resume, plan, exit" -ForegroundColor Gray
    
    while ($true) {
        $cmd = Read-Host "`nroo-flow>"
        switch ($cmd.Trim().ToLower()) {
            "exit" { return }
            "quit" { return }
            "status" { Show-Status }
            "plan" { Invoke-PlanWizard }
            "next" {
                try { Invoke-Lock; Invoke-StateTransition }
                catch { Write-Log -Level FAIL -Message "$_" }
                finally { Invoke-Unlock }
            }
            "reset" {
                try { Invoke-Lock; Invoke-ResetWorkflow }
                catch { Write-Log -Level FAIL -Message "$_" }
                finally { Invoke-Unlock }
            }
            "undo" {
                try { Invoke-Lock; Invoke-UndoTransition }
                catch { Write-Log -Level FAIL -Message "$_" }
                finally { Invoke-Unlock }
            }
            "resume" {
                try { Invoke-Lock; Invoke-ResumeExecution }
                catch { Write-Log -Level FAIL -Message "$_" }
                finally { Invoke-Unlock }
            }
            default {
                if ($cmd.Trim() -ne "") {
                    Write-Host "Unknown command. Available: next, status, reset, undo, resume, plan, exit" -ForegroundColor Red
                }
            }
        }
    }
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

try {
    # Acquire lock for state-modifying operations (not -Status or -Plan or -Interactive)
    $needsLock = ($Next -or $Reset -or $Undo -or $Resume -or $InjectPlan)
    if ($needsLock) { Invoke-Lock }

    if ($Interactive) {
        Invoke-InteractiveRepl
    }
    elseif ($Plan) {
        Invoke-PlanWizard
    }
    elseif ($Status) {
        Show-Status
    }
    elseif ($Reset) {
        Invoke-ResetWorkflow
    }
    elseif ($Next) {
        Invoke-StateTransition
    }
    elseif ($Undo) {
        Invoke-UndoTransition
    }
    elseif ($Resume) {
        Invoke-ResumeExecution
    }
    elseif ($InjectPlan) {
        Write-Host "`n=== INJECTING EXTERNAL PLAN (V6 reconciled) ===" -ForegroundColor Cyan

        # 1. Validate file exists
        if (-not (Test-Path $InjectPlan)) {
            throw "The specified plan file does not exist: $InjectPlan"
        }
        Write-Host "Source: $InjectPlan" -ForegroundColor Gray

        # 2. Clean ACTIVE directory (except QUALITY_GATES.md)
        if (Test-Path $ActiveDir) {
            $staleFiles = Get-ChildItem -Path $ActiveDir -File | Where-Object { $_.Name -ne "QUALITY_GATES.md" }
            foreach ($file in $staleFiles) { Remove-Item -Path $file.FullName -Force }
            Write-Host "  Cleaned ACTIVE directory." -ForegroundColor Green
        }

        # 3. Try to call the dashboard's /api/ingest/prd?mode=reconcile endpoint.
        #    The reconciler preserves the user's original markdown verbatim under
        #    `## Original Plan` AND produces gate-compliant headings -- replacing
        #    the legacy hard-coded dummies that lost user intent.
        $sourceMarkdown = Get-Content -Path $InjectPlan -Raw -Encoding UTF8
        $reconciled = $null
        $dashboardUrl = "http://127.0.0.1:3000/api/ingest/prd"
        try {
            $bodyJson = @{ markdown = $sourceMarkdown; mode = "reconcile" } | ConvertTo-Json -Compress -Depth 4
            $resp = Invoke-WebRequest -Uri $dashboardUrl -Method Post -ContentType "application/json" `
                -Body $bodyJson -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
            $payload = $resp.Content | ConvertFrom-Json
            if ($payload.reconciled -and $payload.reconciled.phasePlan -and $payload.reconciled.detailedPlan -and $payload.reconciled.planReview) {
                $reconciled = $payload.reconciled
                Write-Host "  Reconciled via dashboard (kind=$($payload.kind), confidence=$([math]::Round($payload.confidence, 2)))" -ForegroundColor Green
            }
        }
        catch {
            Write-Log -Level WARN -Message "Dashboard not reachable at $dashboardUrl ($($_.Exception.Message)). Falling back to legacy dummy-file injection."
        }

        if ($reconciled) {
            # 4a. V6 path -- use reconciled triplet, preserves original under ## Original Plan.
            # Reconciler emits STATUS: PENDING -- the Director must replace it with
            # APPROVED or NEEDS_REVISION before -Next will pass Gate 3.
            Set-Content -Path (Join-Path $ActiveDir "PHASE_PLAN.md")    -Value $reconciled.phasePlan    -Encoding UTF8
            Set-Content -Path (Join-Path $ActiveDir "DETAILED_PLAN.md") -Value $reconciled.detailedPlan -Encoding UTF8
            Set-Content -Path (Join-Path $ActiveDir "PLAN_REVIEW.md")   -Value $reconciled.planReview   -Encoding UTF8

            # Multi-phase: persist queue so subsequent cycles auto-start on COMPLETE.
            if ($reconciled.PSObject.Properties.Match('phaseQueue').Count -gt 0 -and $reconciled.phaseQueue -and $reconciled.phaseQueue.cycles.Count -gt 1) {
                $queuePath = Join-Path $WorkflowDir 'PHASE_QUEUE.json'
                $queueJson = $reconciled.phaseQueue | ConvertTo-Json -Depth 6
                Invoke-AtomicJsonWrite -Path $queuePath -JsonContent $queueJson
                Write-Host "  Wrote PHASE_QUEUE.json with $($reconciled.phaseQueue.cycles.Count) phases" -ForegroundColor Cyan
            }

            Write-Host "  Wrote reconciled PHASE_PLAN.md, DETAILED_PLAN.md, PLAN_REVIEW.md (PENDING -- Director must approve)" -ForegroundColor Green
        }
        else {
            # 4b. Legacy fallback -- only when the dashboard isn't running.
            $dummyPhase = "# Phase Plan`n`n## Phase 1: Injected`nGoal: Injected externally (legacy fallback).`nScope: All.`nDependencies: None.`nSuccess Criteria: Executed.`n"
            Set-Content -Path (Join-Path $ActiveDir "PHASE_PLAN.md") -Value $dummyPhase -Encoding UTF8
            $dummyDetailed = (Get-Content $InjectPlan -Raw) + "`n`n## Files to Modify`n| File | Action |`n|------|--------|`n| _to be enumerated by the Director_ | _MODIFY/CREATE_ |`n`n## Implementation Steps`n_To be enumerated by the Director from the source above._`n"
            Set-Content -Path (Join-Path $ActiveDir "DETAILED_PLAN.md") -Value $dummyDetailed -Encoding UTF8
            $dummyReview = "# Plan Review`n`nSTATUS: PENDING -- Director must review DETAILED_PLAN.md and replace this line with APPROVED or NEEDS_REVISION.`n`n## Reviewer Notes`nPlan injected via -InjectPlan (legacy fallback path; dashboard offline).`n"
            Set-Content -Path (Join-Path $ActiveDir "PLAN_REVIEW.md") -Value $dummyReview -Encoding UTF8
            Write-Log -Level WARN -Message "Used legacy dummy-file injection. Start the dashboard (npm start --prefix workflow-dashboard) to enable V6 reconciliation that preserves your original plan."
        }

        # 5. Land in PLAN_REVIEW so the Director must actually review before EXECUTION.
        $currentState = Get-CurrentState
        $statusData = Get-StatusData -State $currentState
        $nextConfig = $StateConfigs["PLAN_REVIEW"]
        $transitionCount = [int]$statusData["Transition Count"] + 3
        $newCycleId = [guid]::NewGuid().ToString().Substring(0,8)
        Write-StatusFile -State "PLAN_REVIEW" `
            -PreviousState $currentState `
            -Phase "Injected Plan" `
            -CycleStart (Get-Date -Format "o") `
            -CycleId $newCycleId `
            -LastTransition (Get-Date -Format "o") `
            -TransitionCount $transitionCount `
            -RetryCount 0 `
            -NextAction $nextConfig.Instruction `
            -NextMode $nextConfig.ActiveMode `
            -Status "IN_PROGRESS"

        Write-CurrentInstruction -State "PLAN_REVIEW" -ActiveMode $nextConfig.ActiveMode -Instruction $nextConfig.Instruction

        Invoke-GitCommit -FromState "INJECT" -ToState "PLAN_REVIEW" -PhaseName "Injected Plan" -TransitionCount $transitionCount

        Write-Host "  Status set to PLAN_REVIEW. Director must review DETAILED_PLAN.md and stamp APPROVED before -Next will advance." -ForegroundColor Green
        Write-Host "`nSUCCESS: Plan injected. Switch to DIRECTOR mode to review." -ForegroundColor Green
    }
    else {
        Write-Host "Roo Code Workflow Orchestrator v3" -ForegroundColor Cyan
        Write-Host "Usage:" -ForegroundColor White
        Write-Host "  -Status      Show current workflow status" -ForegroundColor Gray
        Write-Host "  -Reset       Reset workflow to INIT state" -ForegroundColor Gray
        Write-Host "  -Next        Advance to next state" -ForegroundColor Gray
        Write-Host "  -Undo        Roll back to previous state" -ForegroundColor Gray
        Write-Host "  -Resume      Reset RetryCount and re-enter EXECUTION (after manual fix)" -ForegroundColor Gray
        Write-Host "  -InjectPlan  Inject external plan and bypass to EXECUTION" -ForegroundColor Gray
        Write-Host "  -Plan        Interactive plan creation wizard" -ForegroundColor Gray
        Write-Host "  -Interactive Interactive REPL mode" -ForegroundColor Gray
        Write-Host ""
        Show-Status
    }
}
catch {
    Write-Log -Level FAIL -Message "$_"
    Write-Host "Workflow state unchanged." -ForegroundColor Gray
    exit 1
}
finally {
    # Always release lock, even on error
    if ($needsLock) { Invoke-Unlock }
}

