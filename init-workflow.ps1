<#
.SYNOPSIS
    Roo Code Workflow Bootstrap - Sets up the complete multi-agent workflow in any project.

.DESCRIPTION
    Run this single script in the root of any project to install the full
    Director -> Planner -> Executor orchestrated workflow system.
    Creates all directories, templates, rules, modes, orchestrator, and optionally the dashboard.

.PARAMETER SkipDashboard
    Skip installing the workflow-dashboard Node.js app.

.PARAMETER Force
    Overwrite existing files if they exist.

.EXAMPLE
    .\init-workflow.ps1
    .\init-workflow.ps1 -SkipDashboard
    .\init-workflow.ps1 -Force
#>

param(
    [switch]$SkipDashboard,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

Write-Host "`n==================================================" -ForegroundColor Cyan
Write-Host "   [ROO] Workflow Bootstrap v3.2                  " -ForegroundColor Cyan
Write-Host "   Setting up multi-agent workflow system...       " -ForegroundColor Cyan
Write-Host "==================================================`n" -ForegroundColor Cyan

# --- Helper -------------------------------------------------------------------

function Write-FileIfNew {
    param([string]$Path, [string]$Content)
    
    if ((Test-Path $Path) -and -not $Force) {
        Write-Host "  SKIP [exists]: $Path" -ForegroundColor Gray
        return
    }
    
    $dir = Split-Path $Path -Parent
    if (-not [string]::IsNullOrEmpty($dir) -and -not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    Set-Content -Path $Path -Value $Content -Encoding UTF8
    Write-Host "  CREATED: $Path" -ForegroundColor Green
}

# --- Directories --------------------------------------------------------------

Write-Host "1. Creating directories..." -ForegroundColor Yellow
$dirs = @("WORKFLOW/ACTIVE", "WORKFLOW/HISTORY", ".roo/rules", "plans")
foreach ($d in $dirs) {
    if (-not (Test-Path $d)) {
        New-Item -ItemType Directory -Path $d -Force | Out-Null
        Write-Host "  CREATED: $d/" -ForegroundColor Green
    } else {
        Write-Host "  EXISTS:  $d/" -ForegroundColor Gray
    }
}

# --- ORCHESTRATION_STATUS.json (machine-managed state file) ------------------

Write-Host "`n2. Creating workflow templates..." -ForegroundColor Yellow

Write-FileIfNew "WORKFLOW/ORCHESTRATION_STATUS.json" @'
{
  "schemaVersion": 1,
  "currentState": "INIT",
  "previousState": "",
  "phase": "",
  "cycleStart": "",
  "cycleId": "",
  "lastTransition": "",
  "transitionCount": 0,
  "retryCount": 0,
  "nextAction": "Provide a feature request to the Director",
  "nextMode": "director",
  "status": "IN_PROGRESS",
  "blockedReason": "",
  "autopilot": false,
  "parallelTracks": false
}
'@

# --- QUALITY_GATES.md ---------------------------------------------------------

Write-FileIfNew "WORKFLOW/ACTIVE/QUALITY_GATES.md" @"
# Quality Gates

All transitions between workflow states require passing the corresponding quality gate.
The orchestrator script validates these gates programmatically before allowing transitions.

---

## Quality Gate 1 - Phase Plan Gate

**Trigger:** Before transitioning from PHASE_PLANNING â†’ DETAILED_PLANNING
**File:** ``WORKFLOW/ACTIVE/PHASE_PLAN.md``
**Automated Check:** Must contain at least one ``## Phase N`` section header.

### Checklist
- [ ] PHASE_PLAN.md exists in WORKFLOW/ACTIVE/
- [ ] At least one phase defined (## Phase N:)
- [ ] Each phase has: Goal, Scope, Dependencies, Success Criteria
- [ ] No implementation details specified
- [ ] LESSONS_LEARNED.md was read before writing

---

## Quality Gate 2 - Detailed Plan Gate

**Trigger:** Before transitioning from DETAILED_PLANNING â†’ PLAN_REVIEW
**File:** ``WORKFLOW/ACTIVE/DETAILED_PLAN.md``
**Automated Check:** Must contain ``## Files to Modify`` or ``## Implementation Steps`` sections.

### Checklist
- [ ] DETAILED_PLAN.md has Summary section
- [ ] Files to Modify table with valid references
- [ ] Each step has risk assessment (LOW/MEDIUM/HIGH)
- [ ] Test plan is actionable

---

## Quality Gate 3 - Plan Approval Gate

**Trigger:** Before transitioning from PLAN_REVIEW â†’ EXECUTION
**File:** ``WORKFLOW/ACTIVE/PLAN_REVIEW.md``
**Automated Check:** Must contain ``STATUS: APPROVED`` or ``STATUS: NEEDS_REVISION``.

### Checklist
- [ ] PLAN_REVIEW.md has STATUS field
- [ ] PLAN_APPROVED.md exists (if APPROVED)

---

## Quality Gate 4 - Execution Gate

**Trigger:** Before transitioning from EXECUTION â†’ EXECUTION_REVIEW
**File:** ``WORKFLOW/ACTIVE/EXECUTION_REPORT.md``
**Automated Check:** Must contain ``## Files Modified`` and ``## Tests Run`` sections.

### Checklist
- [ ] Files Modified table lists all changes
- [ ] Tests Run section documents results
- [ ] No scope creep

---

## Quality Gate 5 - Execution Approval Gate

**Trigger:** Before transitioning from EXECUTION_REVIEW â†’ ARCHIVE
**File:** ``WORKFLOW/ACTIVE/EXECUTION_REVIEW.md``
**Automated Check:** Must contain ``STATUS: APPROVED`` or ``STATUS: NEEDS_REVISION``.

### Checklist
- [ ] STATUS field present
- [ ] Lessons documented

---

## Quality Gate Summary

| Gate | File                | Automated Check                    | Fail State                |
| ---- | ------------------- | ---------------------------------- | ------------------------- |
| 1    | PHASE_PLAN.md       | ``## Phase N`` header exists       | PHASE_PLANNING (retry)    |
| 2    | DETAILED_PLAN.md    | Required sections present          | DETAILED_PLANNING (retry) |
| 3    | PLAN_REVIEW.md      | STATUS field present               | DETAILED_PLANNING         |
| 4    | EXECUTION_REPORT.md | Files Modified + Tests Run present | EXECUTION (retry)         |
| 5    | EXECUTION_REVIEW.md | STATUS field present               | EXECUTION                 |
"@

# --- LESSONS_LEARNED.md -------------------------------------------------------

Write-FileIfNew "WORKFLOW/LESSONS_LEARNED.md" @"
# Lessons Learned

Self-learning system for the Three-Layer Agentic Workflow.
Each completed phase contributes patterns that improve future phases.

> **Cap:** Keep max ~20 active lessons. Graduate older ones to HISTORY/LESSONS_ARCHIVE.md.

---

## Active Patterns (auto-detected recurring themes)

| Pattern | Tag | Frequency | First Seen | Last Seen | Mitigation |
| ------- | --- | --------- | ---------- | --------- | ---------- |

---

## Best Practices

### Director
- Always read LESSONS_LEARNED.md and PHASE_DNA.md before planning
- Keep phase plans HIGH-LEVEL only
- Success criteria must be measurable

### Planner
- Always read all relevant files before planning
- No implementation details in plans
- Risk assessments must be realistic

### Executor
- Run tests after EVERY change
- Never fix out-of-scope issues
- Document everything in EXECUTION_REPORT.md
"@

# --- PHASE_DNA.md -------------------------------------------------------------

Write-FileIfNew "WORKFLOW/PHASE_DNA.md" @"
# Phase DNA - Project Evolutionary Memory

Stores context and knowledge that must be passed forward to future phases.

> **Cap:** Keep max ~15 Active Memory rows. Prune stale entries after their relevant phase passes.

---

## Active Memory (context still relevant to future phases)

| Context | Relevant Until | Why | Last Verified |
| ------- | -------------- | --- | ------------- |

---

## Architectural Decisions

| Decision | Date | Reason | Impact |
| -------- | ---- | ------ | ------ |

---

## Technical Debt

| Item | Severity | Phase Created | Notes |
| ---- | -------- | ------------- | ----- |

---

## Shared Knowledge

Information that should be known across all modes.

### Project Structure
- (Filled in during Phase 1)

### Dependencies
- (Filled in during Phase 1)

### Conventions
- (Established during first phases)

---

## Phase History

| # | Date | Phase | Key Outcome | Status |
| - | ---- | ----- | ----------- | ------ |
"@

# --- QUALITY_DASHBOARD.md -----------------------------------------------------

Write-FileIfNew "WORKFLOW/QUALITY_DASHBOARD.md" @"
# Quality Dashboard

| Timestamp | Gate | Result | Notes |
|-----------|------|--------|-------|
"@

# --- SELF_REVIEW_CHECKLIST.md -------------------------------------------------

Write-FileIfNew "WORKFLOW/SELF_REVIEW_CHECKLIST.md" @"
# Self-Review Checklists

Each mode must run its self-review checklist before marking work complete.

---

## Director Self-Review Checklist

### Phase Planning (before writing PHASE_PLAN.md)
- [ ] I have read WORKFLOW/LESSONS_LEARNED.md
- [ ] I have read WORKFLOW/PHASE_DNA.md
- [ ] Phase plan is HIGH-LEVEL only (max 10 lines per phase)
- [ ] No implementation details specified
- [ ] Each phase has: Goal, Scope, Dependencies, Success Criteria

### Plan Review (before writing PLAN_REVIEW.md)
- [ ] DETAILED_PLAN.md is comprehensive
- [ ] Risk assessments are realistic
- [ ] Test plan is actionable

### Execution Review (before writing EXECUTION_REVIEW.md)
- [ ] EXECUTION_REPORT.md is complete
- [ ] Only planned files were modified
- [ ] Tests passed
- [ ] At least one lesson identified for LESSONS_LEARNED.md

### Final Check (before running orchestrator.ps1 -Next to COMPLETE)
- [ ] WORKFLOW/LESSONS_LEARNED.md has been updated
- [ ] WORKFLOW/PHASE_DNA.md has been updated
- [ ] Learning files saved BEFORE writing STATUS: APPROVED

---

## Planner Self-Review Checklist

### Before Starting
- [ ] I have read WORKFLOW/LESSONS_LEARNED.md
- [ ] I have read WORKFLOW/PHASE_DNA.md
- [ ] I have read PHASE_PLAN.md fully

### After Writing DETAILED_PLAN.md
- [ ] Every file in "Files to Modify" is accurate
- [ ] Each step has risk assessment
- [ ] Test plan is actionable
- [ ] No implementation details leaked

---

## Executor Self-Review Checklist

### Before Starting
- [ ] I have read WORKFLOW/LESSONS_LEARNED.md
- [ ] I have read PLAN_APPROVED.md fully

### After Completing
- [ ] Only planned files were modified
- [ ] No scope creep
- [ ] All tests pass
- [ ] EXECUTION_REPORT.md is accurate
- [ ] Out-of-scope issues documented (not fixed)

### Escalation Check
- [ ] I have tried the fix 2 times max
- [ ] I have used external tools (Browser/MCP/File Search) for research
- [ ] If still stuck: ESCALATION.md created, workflow BLOCKED
"@

# --- HISTORY_LOG.md -----------------------------------------------------------

Write-FileIfNew "WORKFLOW/HISTORY/HISTORY_LOG.md" @"
# History Log

Track all saved workflow phases for historical reference and audit.
"@

# --- Agent Rules --------------------------------------------------------------

Write-Host "`n3. Creating agent rules..." -ForegroundColor Yellow

# Copy existing rules if they exist in the source, otherwise create templates
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Check if we have existing rules to copy (for device-to-device transfer)
$sourceRulesDir = Join-Path $scriptDir ".roo/rules"
$hasExistingRules = (Test-Path "$sourceRulesDir/director-rules.md") -and 
                    (Test-Path "$sourceRulesDir/executor-rules.md") -and 
                    (Test-Path "$sourceRulesDir/planner-rules.md")

if (-not $hasExistingRules) {
    # Create fresh rule templates

Write-FileIfNew ".roo/rules/director-rules.md" @"
You are the DIRECTOR of this software project.

Your ONLY responsibilities:
1. Write high-level phase plans (NOT detailed - max 10 lines per phase)
2. Evaluate detailed plans from the Planner
3. Evaluate execution reports from the Executor
4. Approve OR request specific improvements

STRICT RULES:
- NEVER write code
- NEVER make detailed implementation decisions
- Be concise - you are expensive
- ALWAYS read WORKFLOW/LESSONS_LEARNED.md before writing any plan
- ALWAYS read WORKFLOW/PHASE_DNA.md for context from previous phases
- ALWAYS run WORKFLOW/SELF_REVIEW_CHECKLIST.md before completing any work
- ALWAYS check WORKFLOW/ORCHESTRATION_STATUS.json to know current workflow state (READ-ONLY - do NOT edit it)

---

## WORKFLOW

### After Writing Any Output File
1. Run self-review checklist
2. Verify the corresponding quality gate passes
3. Tell the user to run ``orchestrator.ps1 -Next`` to transition

### EXECUTION_REVIEW - CRITICAL SEQUENCE
> Update LESSONS_LEARNED.md and PHASE_DNA.md FIRST.
> **IMPORTANT:** Always prefix new lessons with Technology Tags (e.g. `[LARAVEL]`, `[FLUTTER]`, `[GENERAL]`) so they can be filtered.
> Only AFTER learning files are saved, write STATUS: APPROVED to EXECUTION_REVIEW.md.
> The orchestrator auto-saves files to HISTORY when it sees APPROVED.

### Archive Phase
> File saving is handled AUTOMATICALLY by orchestrator.ps1.
> Do NOT manually move, copy, or delete files.
> Just read files, update learning docs, then run ``orchestrator.ps1 -Next``.
"@

Write-FileIfNew ".roo/rules/planner-rules.md" @"
You are the PLANNER of this software project.

Your responsibilities:
1. Read WORKFLOW/ACTIVE/PHASE_PLAN.md to understand the phase
2. Read ALL relevant project files before planning
3. Build a detailed implementation plan
4. Revise plan based on Director feedback until APPROVED

MANDATORY READS BEFORE ANY PLAN:
- WORKFLOW/LESSONS_LEARNED.md (Filter by relevant Technology Tags)
- WORKFLOW/PHASE_DNA.md
- All files in the phase scope
- WORKFLOW/SELF_REVIEW_CHECKLIST.md (Planner section)
- WORKFLOW/ACTIVE/QUALITY_GATES.md (Gate 2 requirements)

---

## After Writing DETAILED_PLAN.md
1. Run self-review checklist
2. Verify QUALITY_GATE_2 passes
3. Tell the user to run ``orchestrator.ps1 -Next`` to transition
"@

Write-FileIfNew ".roo/rules/executor-rules.md" @"
You are the EXECUTOR of this software project.

Your responsibilities:
1. Read WORKFLOW/ACTIVE/PLAN_APPROVED.md
2. Implement EXACTLY what is planned - NOTHING MORE
3. Run tests after EVERY change
4. Write a detailed execution report
5. Fix issues based on Director feedback (Read WORKFLOW/ACTIVE/EXECUTION_REVIEW.md if this is a retry)

STRICT RULES:
- NEVER modify files not listed in the plan
- NEVER "improve" something that was not asked
- NEVER skip running tests
- If you find a bug outside scope â†’ report it, do NOT fix it
- ALWAYS read WORKFLOW/LESSONS_LEARNED.md before starting (Filter by relevant Technology Tags)
- ALWAYS check WORKFLOW/ORCHESTRATION_STATUS.json (READ-ONLY - do NOT edit it)

---

## ESCALATION PROTOCOLS

### 1. Two-Strikes Per Error
> You get MAX 2 attempts to fix any specific error.
> After 2 strikes, coding is FORBIDDEN. You must research first.
1. Strike 1: Identify, hypothesize, fix, test.
2. Strike 2: Re-analyze, different approach, test.
3. After 2 strikes: Use Browser/MCP/File Search for external context.

### 2. Global 5-Attempt Limit
> You get MAX 5 total test failures or fix attempts per EXECUTION phase.
> If you fail 5 times across any combination of errors, the workflow is broken.
> **STOP IMMEDIATELY.** Create ESCALATION.md and tell user workflow is BLOCKED.

## After Completing
1. Write EXECUTION_REPORT.md
2. Tell user to run ``orchestrator.ps1 -Next``
"@

Write-FileIfNew ".roo/rules/workflow-master-rules.md" @"
You are the WORKFLOW MASTER of this software project. 
You are an autonomous agent capable of running the entire development lifecycle end-to-end without human intervention.

## YOUR DYNAMIC ROLE
You encompass the roles of Director, Planner, and Executor. Your active role depends ENTIRELY on the current state defined in `WORKFLOW/ORCHESTRATION_STATUS.json` (field `currentState`).

Read `WORKFLOW/ORCHESTRATION_STATUS.json` first. Based on the `currentState` field, adopt the following persona:

### 1. State: PHASE_PLANNING (Role: DIRECTOR)
- Write high-level phase plans in `WORKFLOW/ACTIVE/PHASE_PLAN.md` (NOT detailed - max 10 lines per phase).
- ALWAYS read `WORKFLOW/LESSONS_LEARNED.md` (filtering by Tech Tags) and `PHASE_DNA.md` first.
- Success criteria must be measurable.

### 2. State: DETAILED_PLANNING (Role: PLANNER)
- Read `PHASE_PLAN.md` and all relevant project files.
- Build a detailed implementation plan in `WORKFLOW/ACTIVE/DETAILED_PLAN.md`.
- Include `## Files to Modify` and `## Implementation Steps`.
- No implementation details leaked into the plan (what to build, not how).

### 3. State: PLAN_REVIEW (Role: DIRECTOR)
- Evaluate `DETAILED_PLAN.md` from the Planner.
- If acceptable, create `WORKFLOW/ACTIVE/PLAN_REVIEW.md` with `STATUS: APPROVED` and copy the plan to `WORKFLOW/ACTIVE/PLAN_APPROVED.md`.
- If changes are needed, write `STATUS: NEEDS_REVISION` with feedback.

### 4. State: EXECUTION (Role: EXECUTOR)
- Read `WORKFLOW/ACTIVE/PLAN_APPROVED.md`.
- Implement EXACTLY what is planned - NOTHING MORE.
- Run tests after EVERY change.
- Never modify files not listed in the plan.
- Max 5-attempt limit for fixing errors. If stuck, escalate to `ESCALATION.md`.
- Write `WORKFLOW/ACTIVE/EXECUTION_REPORT.md` documenting changes and tests.

### 5. State: EXECUTION_REVIEW (Role: DIRECTOR)
- Evaluate `EXECUTION_REPORT.md` and verify code against the plan.
- **Extract Lessons:** Update `LESSONS_LEARNED.md` (with Technology Tags like `[LARAVEL]`) and `PHASE_DNA.md`.
- **CRITICAL:** Wait for learning files to save BEFORE setting approval status.
- Create `WORKFLOW/ACTIVE/EXECUTION_REVIEW.md` with `STATUS: APPROVED` or `STATUS: NEEDS_REVISION`.

---

## STRICT AUTONOMY PROTOCOL
As the Workflow Master, you are bound by the Global Autonomy Rules (`.roorules`).
1. After writing the required files for your current state, **YOU MUST RUN** `.\orchestrator.ps1 -Next`.
2. **DO NOT STOP.** Read the terminal output.
3. Automatically switch your persona to match the new state and **CONTINUE WORKING immediately**.
4. The cycle only pauses if the state becomes `BLOCKED` or `COMPLETE`.
"@

} else {
    # Copy existing rules
    foreach ($ruleFile in @("director-rules.md", "executor-rules.md", "planner-rules.md", "workflow-master-rules.md")) {
        $source = Join-Path $sourceRulesDir $ruleFile
        $dest = ".roo/rules/$ruleFile"
        if ((Test-Path $source) -and (-not (Test-Path $dest) -or $Force)) {
            Copy-Item -Path $source -Destination $dest -Force
            Write-Host "  COPIED: $dest" -ForegroundColor Green
        }
    }
}

# --- Global .roorules ---------------------------------------------------------

Write-Host "`n4. Creating .roorules..." -ForegroundColor Yellow

Write-FileIfNew ".roorules" @"
# Global Roo Code Rules

## STRICT AUTONOMY PROTOCOL
This protocol controls whether the workflow operates as a continuous loop or requires manual advancement.

1. **Check Autopilot State:** After successfully completing the required actions for any phase (e.g., writing the necessary files), you MUST read `WORKFLOW/ORCHESTRATION_STATUS.json` and check the `autopilot` field.
2. **If Autopilot is OFF:** You MUST STOP and wait. DO NOT run the orchestrator. Simply inform the user you have finished and they should click "Next Phase" in the dashboard.
3. **If Autopilot is ON:**
   - **Auto-Advance:** You MUST autonomously run the command: `.\orchestrator.ps1 -Next`
   - **Read Output:** You MUST read the terminal output to determine the new system state.
   - **Continuous Execution:** If the new state is NOT `COMPLETE` and NOT `BLOCKED`, you MUST immediately begin performing the tasks required for the newly assigned state. Do not stop to ask the user what to do next.
4. **Unrestricted Action:** When Autopilot is ON, you are fully authorized to run commands, edit files, and recursively advance the orchestrator state until `COMPLETE` or `BLOCKED`.
"@

# --- Stack Detection ----------------------------------------------------------
$laravelDir = if (Test-Path "artisan") { "." } else { (Get-ChildItem -Directory | Where-Object { Test-Path "$($_.FullName)/artisan" } | Select-Object -First 1).Name }
$flutterDir = if (Test-Path "pubspec.yaml") { "." } else { (Get-ChildItem -Directory | Where-Object { Test-Path "$($_.FullName)/pubspec.yaml" } | Select-Object -First 1).Name }

if ($laravelDir -or $flutterDir) {
    $stackRules = "`n`n## PROJECT-SPECIFIC STACK"
    if ($laravelDir -and $flutterDir) {
        $stackRules += " (MONOREPO)`nThis specific project is structured as a Monorepo containing a Laravel Backend and a Flutter Frontend."
        $stackRules += "`n- **Backend Commands:** All Laravel/PHP commands MUST be executed inside the /$laravelDir directory."
        $stackRules += "`n- **Frontend Commands:** All Flutter commands MUST be executed inside the /$flutterDir directory."
        $stackRules += "`n- **Planning:** The Planner must explicitly categorize tasks into `"Backend`" and `"Frontend`" sections in DETAILED_PLAN.md."
        $stackRules += "`n- **Lessons Learned:** Use strict tags (`[LARAVEL]`, `[FLUTTER]`, `[GENERAL]`) when updating LESSONS_LEARNED.md."
    } elseif ($laravelDir) {
        $stackRules += " (LARAVEL)`nThis specific project is a Laravel application."
        if ($laravelDir -ne ".") { $stackRules += "`n- **Backend Commands:** All Laravel/PHP commands MUST be executed inside the /$laravelDir directory." }
        $stackRules += "`n- **Lessons Learned:** Use the tag `[LARAVEL]` or `[GENERAL]` when updating LESSONS_LEARNED.md."
    } elseif ($flutterDir) {
        $stackRules += " (FLUTTER)`nThis specific project is a Flutter application."
        if ($flutterDir -ne ".") { $stackRules += "`n- **Frontend Commands:** All Flutter commands MUST be executed inside the /$flutterDir directory." }
        $stackRules += "`n- **Lessons Learned:** Use the tag `[FLUTTER]` or `[GENERAL]` when updating LESSONS_LEARNED.md."
    }
    
    Add-Content -Path ".roorules" -Value $stackRules
    Write-Host "  DETECTED STACK: Appended stack-specific rules to .roorules" -ForegroundColor Green
}

# --- .roomodes ----------------------------------------------------------------

Write-Host "`n5. Creating .roomodes..." -ForegroundColor Yellow

Write-FileIfNew ".roomodes" @'
{
  "customModes": [
    {
      "slug": "director",
      "name": "Director",
      "roleDefinition": "You are the DIRECTOR of this software project. Your ONLY responsibilities:\n1. Write high-level phase plans (NOT detailed - max 10 lines per phase)\n2. Evaluate detailed plans from the Planner\n3. Evaluate execution reports from the Executor\n4. Approve OR request specific improvements\n\nSTRICT RULES:\n- NEVER write code\n- NEVER make detailed implementation decisions\n- Be concise - you are expensive\n- ALWAYS read WORKFLOW/LESSONS_LEARNED.md before writing any plan\n- ALWAYS read WORKFLOW/PHASE_DNA.md for context from previous phases\n- ALWAYS run WORKFLOW/SELF_REVIEW_CHECKLIST.md before completing any work\n- ALWAYS check WORKFLOW/ORCHESTRATION_STATUS.json to know current workflow state (READ-ONLY)",
      "groups": [
        "read",
        [
          "edit",
          {
            "fileRegex": "\\.md$",
            "description": "Markdown files only"
          }
        ]
      ]
    },
    {
      "slug": "planner",
      "name": "Planner",
      "roleDefinition": "You are the PLANNER of this software project. Your responsibilities:\n1. Read WORKFLOW/ACTIVE/PHASE_PLAN.md to understand the phase\n2. Read ALL relevant project files before planning\n3. Build a detailed implementation plan\n4. Revise plan based on Director feedback until APPROVED\n\nMANDATORY READS BEFORE ANY PLAN:\n- WORKFLOW/LESSONS_LEARNED.md (avoid past mistakes)\n- WORKFLOW/PHASE_DNA.md (context from previous phases)\n- All files in the phase scope\n- WORKFLOW/SELF_REVIEW_CHECKLIST.md (Planner section)\n- WORKFLOW/ACTIVE/QUALITY_GATES.md (Gate 2 requirements)",
      "groups": [
        "read",
        [
          "edit",
          {
            "fileRegex": "\\.md$",
            "description": "Markdown files only"
          }
        ]
      ]
    },
    {
      "slug": "executor",
      "name": "Executor",
      "roleDefinition": "You are the EXECUTOR of this software project. Your responsibilities:\n1. Read WORKFLOW/ACTIVE/PLAN_APPROVED.md\n2. Implement EXACTLY what is planned - NOTHING MORE\n3. Run tests after EVERY change\n4. Write a detailed execution report\n5. Fix issues based on Director feedback\n\nSTRICT RULES:\n- NEVER modify files not listed in the plan\n- NEVER \"improve\" something that was not asked\n- NEVER skip running tests\n- If you find a bug outside scope -> report it, do NOT fix it\n- ALWAYS read WORKFLOW/LESSONS_LEARNED.md before starting\n- ALWAYS run WORKFLOW/SELF_REVIEW_CHECKLIST.md before completing any work\n- ALWAYS check WORKFLOW/ORCHESTRATION_STATUS.json to know current workflow state (READ-ONLY)",
      "groups": [
        "read",
        [
          "edit",
          {
            "fileRegex": ".*",
            "description": "All files"
          }
        ],
        "command",
        "browser",
        "mcp"
      ]
    },
    {
      "slug": "workflow-master",
      "name": "Workflow Master",
      "roleDefinition": "You are the WORKFLOW MASTER. You encompass the roles of Director, Planner, and Executor. \nYou are an AUTONOMOUS AGENT capable of running the entire development lifecycle end-to-end.\n\nRead WORKFLOW/ORCHESTRATION_STATUS.json first. Based on the Current State, adopt the appropriate persona:\n- PHASE_PLANNING: Act as DIRECTOR (Write PHASE_PLAN.md)\n- DETAILED_PLANNING: Act as PLANNER (Write DETAILED_PLAN.md)\n- PLAN_REVIEW: Act as DIRECTOR (Write PLAN_REVIEW.md & PLAN_APPROVED.md)\n- EXECUTION: Act as EXECUTOR (Implement code, Write EXECUTION_REPORT.md)\n- EXECUTION_REVIEW: Act as DIRECTOR (Update lessons, Write EXECUTION_REVIEW.md)\n\nSTRICT AUTONOMY PROTOCOL:\n1. After completing the output files for your current state, you MUST check the `autopilot` field in `WORKFLOW/ORCHESTRATION_STATUS.json`.\n2. If OFF: STOP. Do not run the orchestrator. Tell the user to click \"Next Phase\" in the dashboard.\n3. If ON: YOU MUST RUN `.\\orchestrator.ps1 -Next`. Read the terminal output. Automatically switch your persona and CONTINUE WORKING immediately.\n4. DO NOT STOP until the state is COMPLETE or BLOCKED.",
      "groups": [
        "read",
        [
          "edit",
          {
            "fileRegex": ".*",
            "description": "All files"
          }
        ],
        "command",
        "browser",
        "mcp"
      ]
    }
  ]
}
'@

# --- MANIFEST.json ------------------------------------------------------------

Write-Host "`nCreating MANIFEST.json..." -ForegroundColor Yellow

$manifestStackName = "Agnostic"
if ($laravelDir -and $flutterDir) {
    $manifestStackName = "Monorepo (Laravel+Flutter)"
} elseif ($laravelDir) {
    $manifestStackName = "Laravel"
} elseif ($flutterDir) {
    $manifestStackName = "Flutter"
}

$now = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ")
$ManifestJsonContent = @"
{
  "version": "3.2.0",
  "schemaVersion": 1,
  "stack": "$manifestStackName",
  "installedAt": "$now"
}
"@
Write-FileIfNew "WORKFLOW/MANIFEST.json" $ManifestJsonContent

# --- workflow-config.json -----------------------------------------------------

Write-Host "`n6. Creating workflow-config.json..." -ForegroundColor Yellow

Write-FileIfNew "WORKFLOW/workflow-config.json" @'
{
  "tokenBudgets": {
    "planning": 150000,
    "execution": 500000,
    "review": 100000
  },
  "contextSizeLimits": {
    "maxFileSizeBytes": 51200,
    "maxContextTotalBytes": 524288
  },
  "pollingRateMs": 1000,
  "autopilotSettings": {
    "allowFullAutonomy": false
  }
}
'@

# --- Orchestrator -------------------------------------------------------------

Write-Host "`n7. Installing orchestrator..." -ForegroundColor Yellow

$orchestratorSource = Join-Path $scriptDir "orchestrator.ps1"
if ((Test-Path $orchestratorSource) -and ($orchestratorSource -ne (Resolve-Path "orchestrator.ps1" -ErrorAction SilentlyContinue))) {
    if (-not (Test-Path "orchestrator.ps1") -or $Force) {
        Copy-Item -Path $orchestratorSource -Destination "orchestrator.ps1" -Force
        Write-Host "  COPIED: orchestrator.ps1" -ForegroundColor Green
    } else {
        Write-Host "  SKIP (exists): orchestrator.ps1" -ForegroundColor Gray
    }
} else {
    if (Test-Path "orchestrator.ps1") {
        Write-Host "  EXISTS: orchestrator.ps1" -ForegroundColor Gray
    } else {
        Write-Host "  WARNING: orchestrator.ps1 not found. Copy it manually from the source project." -ForegroundColor Red
    }
}


# --- DASHBOARD ASSETS ---------------------------------------------------------

$ServerJsContent = @'
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Paths relative to the workflow-dashboard directory
const WORKFLOW_DIR = path.join(__dirname, '..', 'WORKFLOW');
const STATUS_FILE = path.join(WORKFLOW_DIR, 'ORCHESTRATION_STATUS.json');
const METRICS_FILE = path.join(WORKFLOW_DIR, 'METRICS.json');
const DASHBOARD_FILE = path.join(WORKFLOW_DIR, 'QUALITY_DASHBOARD.md');
const ORCHESTRATOR_SCRIPT = path.join(__dirname, '..', 'orchestrator.ps1');

/**
 * Read and parse ORCHESTRATION_STATUS.json.
 * Returns a normalized object with camelCase keys for the frontend.
 */
function readStatus() {
  const defaultStatus = {
    currentState: 'INIT',
    previousState: '',
    phase: '',
    cycleStart: '',
    lastTransition: '',
    transitionCount: 0,
    retryCount: 0,
    nextAction: '',
    nextMode: '',
    status: 'IN_PROGRESS',
    blockedReason: '',
    autopilot: false
  };

  if (!fs.existsSync(STATUS_FILE)) {
    return defaultStatus;
  }

  // Retry logic for concurrent file writes
  let retries = 3;
  while (retries > 0) {
    try {
      const raw = fs.readFileSync(STATUS_FILE, 'utf-8');
      if (raw.trim()) {
        return JSON.parse(raw);
      }
    } catch (e) {
      retries--;
      if (retries === 0) throw e;
      // Sleep briefly (synchronous busy-wait fallback for Node without sleep)
      const start = Date.now();
      while(Date.now() - start < 50) {} 
    }
  }
  return defaultStatus;
}

/**
 * Write the full JSON status object back to disk.
 */
function writeStatus(data) {
  fs.writeFileSync(STATUS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// GET /api/status - Read and return parsed ORCHESTRATION_STATUS.json
app.get('/api/status', (req, res) => {
  try {
    const data = readStatus();
    // Also provide the legacy key format for backward compat with existing frontend
    res.json({
      'Current State': data.currentState,
      'Previous State': data.previousState || '',
      'Phase': data.phase || '',
      'Cycle Start': data.cycleStart || '',
      'Last Transition': data.lastTransition || '',
      'Transition Count': String(data.transitionCount || 0),
      'Retry Count': String(data.retryCount || 0),
      'Next Action': data.nextAction || '',
      'Next Mode': data.nextMode || '',
      'Status': data.status || 'IN_PROGRESS',
      'Blocked Reason': data.blockedReason || '',
      'Autopilot': data.autopilot ? 'ON' : 'OFF',
      // Raw object for advanced frontend features
      _raw: data
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard - Read and return QUALITY_DASHBOARD.md
app.get('/api/dashboard', (req, res) => {
  try {
    if (!fs.existsSync(DASHBOARD_FILE)) {
      return res.json({ content: '# Quality Dashboard\n\nNo data yet.' });
    }
    const content = fs.readFileSync(DASHBOARD_FILE, 'utf-8');
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/metrics - Read and return METRICS.json
app.get('/api/metrics', (req, res) => {
  try {
    if (!fs.existsSync(METRICS_FILE)) {
      return res.json({ cycles: [] });
    }
    const content = fs.readFileSync(METRICS_FILE, 'utf-8');
    res.json(JSON.parse(content));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/next - Run orchestrator.ps1 -Next
app.post('/api/next', (req, res) => {
  const cmd = `powershell.exe -ExecutionPolicy Bypass -File "${ORCHESTRATOR_SCRIPT}" -Next`;

  exec(cmd, { cwd: path.join(__dirname, '..') }, (error, stdout, stderr) => {
    res.json({
      success: !error,
      stdout: stdout || '',
      stderr: stderr || '',
      error: error ? error.message : null
    });
  });
});

// POST /api/reset - Run orchestrator.ps1 -Reset
app.post('/api/reset', (req, res) => {
  const cmd = `powershell.exe -ExecutionPolicy Bypass -File "${ORCHESTRATOR_SCRIPT}" -Reset`;

  exec(cmd, { cwd: path.join(__dirname, '..') }, (error, stdout, stderr) => {
    res.json({
      success: !error,
      stdout: stdout || '',
      stderr: stderr || '',
      error: error ? error.message : null
    });
  });
});

// POST /api/undo - Run orchestrator.ps1 -Undo
app.post('/api/undo', (req, res) => {
  const cmd = `powershell.exe -ExecutionPolicy Bypass -File "${ORCHESTRATOR_SCRIPT}" -Undo`;

  exec(cmd, { cwd: path.join(__dirname, '..') }, (error, stdout, stderr) => {
    res.json({
      success: !error,
      stdout: stdout || '',
      stderr: stderr || '',
      error: error ? error.message : null
    });
  });
});

// POST /api/inject-plan - Upload a plan document and place it into ACTIVE/
app.post('/api/inject-plan', (req, res) => {
  const { fileName, content } = req.body;
  if (!fileName || !content) {
    return res.status(400).json({ error: "Missing fileName or content" });
  }

  try {
    const activeDir = path.join(WORKFLOW_DIR, 'ACTIVE');
    if (!fs.existsSync(activeDir)) {
      fs.mkdirSync(activeDir, { recursive: true });
    }
    
    fs.writeFileSync(path.join(activeDir, fileName), content, 'utf-8');
    res.json({ success: true, message: `Injected ${fileName}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/resume - Run orchestrator.ps1 -Resume
app.post('/api/resume', (req, res) => {
  const cmd = `powershell.exe -ExecutionPolicy Bypass -File "${ORCHESTRATOR_SCRIPT}" -Resume`;

  exec(cmd, { cwd: path.join(__dirname, '..') }, (error, stdout, stderr) => {
    res.json({
      success: !error,
      stdout: stdout || '',
      stderr: stderr || '',
      error: error ? error.message : null
    });
  });
});

// GET /api/quality-gates - Read quality gate log
app.get('/api/quality-gates', (req, res) => {
  try {
    if (!fs.existsSync(DASHBOARD_FILE)) {
      return res.json({ gates: [] });
    }
    const content = fs.readFileSync(DASHBOARD_FILE, 'utf-8');
    const lines = content.split(/\r?\n/).filter(l => l.startsWith('|') && !l.includes('---') && !l.includes('Timestamp'));
    const gates = lines.map(line => {
      const cols = line.split('|').map(c => c.trim()).filter(Boolean);
      return { timestamp: cols[0], gate: cols[1], result: cols[2], notes: cols[3] || '' };
    }).filter(g => g.timestamp && g.gate);
    res.json({ gates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/autopilot - Toggle Autopilot ON/OFF (writes to JSON)
app.post('/api/autopilot', (req, res) => {
  try {
    const { state } = req.body;
    if (state !== 'ON' && state !== 'OFF') {
      return res.status(400).json({ error: 'State must be ON or OFF' });
    }

    if (!fs.existsSync(STATUS_FILE)) {
      return res.status(404).json({ error: 'Status file not found' });
    }

    const data = readStatus();
    data.autopilot = (state === 'ON');
    writeStatus(data);

    res.json({ success: true, state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/plan - Launch the Plan Wizard
app.post('/api/plan', (req, res) => {
  const cmd = `powershell.exe -ExecutionPolicy Bypass -File "${ORCHESTRATOR_SCRIPT}" -Plan`;

  exec(cmd, { cwd: path.join(__dirname, '..') }, (error, stdout, stderr) => {
    res.json({
      success: !error,
      stdout: stdout || '',
      stderr: stderr || '',
      error: error ? error.message : null
    });
  });
});

app.listen(PORT, () => {
  console.log(`\n  ==================================================`);
  console.log(`     [ROO] Workflow Command Center v3 :${PORT}`);
  console.log(`     -> http://localhost:${PORT}`);
  console.log(`  ==================================================\n`);
});
'@


$IndexHtmlContent = @'
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Workflow Command Center | Roo Code Orchestrator v3</title>
  <meta name="description" content="Real-time workflow orchestration dashboard for Roo Code multi-agent system"/>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet"/>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',sans-serif;background:#0a0a0f;color:#e2e8f0;min-height:100vh}
    .font-mono{font-family:'JetBrains Mono',monospace}
    .glass{background:rgba(15,23,42,0.6);backdrop-filter:blur(16px);border:1px solid rgba(99,102,241,0.15)}
    .glass-hover:hover{border-color:rgba(99,102,241,0.4);box-shadow:0 0 30px rgba(99,102,241,0.08)}
    .glow-text{text-shadow:0 0 20px rgba(99,102,241,0.5)}
    .gradient-border{background:linear-gradient(135deg,rgba(99,102,241,0.3),rgba(168,85,247,0.3),rgba(236,72,153,0.3));padding:1px;border-radius:1rem}
    .gradient-border-inner{background:#0f172a;border-radius:calc(1rem - 1px);height:100%}
    .step-dot{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:700;transition:all 0.5s cubic-bezier(0.4,0,0.2,1);position:relative}
    .step-dot.active{background:linear-gradient(135deg,#6366f1,#8b5cf6);box-shadow:0 0 25px rgba(99,102,241,0.6);animation:pulse-glow 2s infinite}
    .step-dot.done{background:linear-gradient(135deg,#10b981,#059669);box-shadow:0 0 15px rgba(16,185,129,0.3)}
    .step-dot.pending{background:rgba(51,65,85,0.5);border:2px solid rgba(71,85,105,0.5)}
    .step-connector{height:3px;flex:1;min-width:20px;border-radius:2px;transition:all 0.5s ease}
    .step-connector.done{background:linear-gradient(90deg,#10b981,#10b981)}
    .step-connector.active{background:linear-gradient(90deg,#10b981,#6366f1);animation:shimmer 2s infinite}
    .step-connector.pending{background:rgba(51,65,85,0.3)}
    @keyframes pulse-glow{0%,100%{box-shadow:0 0 25px rgba(99,102,241,0.6)}50%{box-shadow:0 0 40px rgba(99,102,241,0.9)}}
    @keyframes shimmer{0%{opacity:.7}50%{opacity:1}100%{opacity:.7}}
    .btn-primary{background:linear-gradient(135deg,#6366f1,#8b5cf6);transition:all .3s ease}
    .btn-primary:hover{transform:translateY(-2px);box-shadow:0 8px 25px rgba(99,102,241,0.4)}
    .btn-primary:active{transform:translateY(0)}
    .btn-danger{background:linear-gradient(135deg,#ef4444,#dc2626);transition:all .3s ease}
    .btn-danger:hover{transform:translateY(-2px);box-shadow:0 8px 25px rgba(239,68,68,0.4)}
    .btn-danger:active{transform:translateY(0)}
    .btn-amber{background:linear-gradient(135deg,#f59e0b,#d97706);transition:all .3s ease}
    .btn-amber:hover{transform:translateY(-2px);box-shadow:0 8px 25px rgba(245,158,11,0.4)}
    .btn-amber:active{transform:translateY(0)}
    .btn-loading{opacity:0.7;pointer-events:none}
    .console-output{background:#020617;border:1px solid rgba(51,65,85,0.5);font-family:'JetBrains Mono',monospace;font-size:0.8rem;max-height:280px;overflow-y:auto;scroll-behavior:smooth}
    .console-output::-webkit-scrollbar{width:6px}
    .console-output::-webkit-scrollbar-track{background:#020617}
    .console-output::-webkit-scrollbar-thumb{background:#334155;border-radius:3px}
    .card-enter{animation:cardFadeIn 0.5s ease forwards}
    @keyframes cardFadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
    .metric-value{font-size:2rem;font-weight:800;background:linear-gradient(135deg,#e2e8f0,#94a3b8);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .status-badge{padding:0.25rem 0.75rem;border-radius:9999px;font-size:0.75rem;font-weight:600;letter-spacing:0.05em;text-transform:uppercase}
    .prompt-area{background:#0f172a;border:1px solid rgba(99,102,241,0.2);border-radius:0.75rem;transition:border-color 0.3s}
    .prompt-area:hover{border-color:rgba(99,102,241,0.5)}
    .copy-btn{transition:all .2s ease}
    .copy-btn:hover{background:rgba(99,102,241,0.2)}
    .copy-btn.copied{background:rgba(16,185,129,0.2);color:#10b981}
  </style>
</head>
<body class="antialiased">

  <!-- Header -->
  <header class="border-b border-slate-800/50 px-6 py-4 flex items-center justify-between glass sticky top-0 z-50">
    <div class="flex items-center gap-3">
      <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-black text-lg shadow-lg shadow-indigo-500/30">R</div>
      <div>
        <h1 class="text-lg font-bold tracking-tight text-white">Workflow Command Center</h1>
        <p class="text-xs text-slate-500 font-medium">Roo Code Orchestrator v3</p>
      </div>
    </div>
    <div class="flex items-center gap-3">
      <div id="connectionDot" class="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-lg shadow-emerald-400/50 animate-pulse"></div>
      <span class="text-xs text-slate-400 font-medium">Live</span>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-6 py-8 space-y-8">

    <!-- Blocked Alert -->
    <div id="blockedAlert" class="hidden card-enter">
      <div class="bg-red-500/10 border border-red-500/40 rounded-xl p-5 flex items-start gap-4">
        <div class="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center shrink-0 mt-0.5">
          <svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>
        </div>
        <div>
          <h3 class="text-red-400 font-bold text-sm">[!] WORKFLOW BLOCKED</h3>
          <p id="blockedReason" class="text-red-300/80 text-sm mt-1">-</p>
          <p class="text-red-400/60 text-xs mt-2">Escalate to Planner or Director for assistance. Use <code class="bg-red-500/10 px-1 rounded">-Undo</code> to rollback.</p>
        </div>
      </div>
    </div>

    <!-- Workflow Stepper -->
    <section class="card-enter">
      <div class="gradient-border">
        <div class="gradient-border-inner p-6">
          <h2 class="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-6">Workflow Pipeline</h2>
          <div id="stepper" class="flex items-center justify-between gap-1 flex-wrap"></div>
        </div>
      </div>
    </section>

    <!-- Metrics Row -->
    <section class="grid grid-cols-1 md:grid-cols-4 gap-4 card-enter" style="animation-delay:0.1s">
      <div class="glass rounded-xl p-5 glass-hover">
        <p class="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-1">Current State</p>
        <p id="metricState" class="metric-value text-xl">-</p>
        <div id="statusBadge" class="mt-2 inline-block status-badge bg-slate-700 text-slate-300">-</div>
      </div>
      <div class="glass rounded-xl p-5 glass-hover">
        <p class="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-1">Cycle Start</p>
        <p id="metricCycleStart" class="text-lg font-bold text-slate-200">-</p>
        <p id="metricElapsed" class="text-xs text-slate-500 mt-1">-</p>
      </div>
      <div class="glass rounded-xl p-5 glass-hover">
        <p class="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-1">Transitions</p>
        <p id="metricTransitions" class="metric-value">0</p>
      </div>
      <div class="glass rounded-xl p-5 glass-hover">
        <p class="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-1">Retries</p>
        <p id="metricRetries" class="metric-value">0</p>
      </div>
    </section>

    <!-- Actions + Prompt -->
    <section class="grid grid-cols-1 lg:grid-cols-2 gap-6 card-enter" style="animation-delay:0.2s">
      <!-- Action Controls -->
      <div class="glass rounded-xl p-6 glass-hover relative">
        <div class="flex items-center justify-between mb-5">
          <h2 class="text-sm font-semibold text-slate-400 uppercase tracking-widest">Action Controls</h2>
          
          <!-- Autopilot Toggle -->
          <div class="flex items-center gap-3 bg-slate-800/50 px-3 py-1.5 rounded-lg border border-slate-700/50">
            <span class="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Autopilot</span>
            <label class="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" id="autopilotToggle" class="sr-only peer" onchange="toggleAutopilot()">
              <div class="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-500"></div>
            </label>
          </div>
        </div>
        <div class="flex gap-3 flex-wrap">
          <button id="btnNext" onclick="triggerNext()" class="btn-primary flex-1 px-5 py-3.5 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg>
            <span>Next Phase</span>
          </button>
          <button id="btnResume" onclick="triggerResume()" class="px-5 py-3.5 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2" style="background:linear-gradient(135deg,#10b981,#059669);transition:all .3s ease" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 25px rgba(16,185,129,0.4)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <span>Resume</span>
          </button>
          <button id="btnUndo" onclick="triggerUndo()" class="btn-amber px-5 py-3.5 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a5 5 0 015 5v2M3 10l4-4m-4 4l4 4"/></svg>
            <span>Undo</span>
          </button>
          <button id="btnReset" onclick="triggerReset()" class="btn-danger px-5 py-3.5 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
            <span>Reset</span>
          </button>
        </div>
        <p id="actionFeedback" class="text-xs text-slate-500 mt-3 text-center">Ready for commands</p>
      </div>

      <!-- Smart Prompt Generator -->
      <div class="glass rounded-xl p-6 glass-hover">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-sm font-semibold text-slate-400 uppercase tracking-widest">Smart Prompt</h2>
          <button id="copyBtn" onclick="copyPrompt()" class="copy-btn px-3 py-1.5 rounded-lg text-xs font-medium text-indigo-400 border border-indigo-500/30 flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>
            <span>Copy</span>
          </button>
        </div>
        <div id="promptArea" class="prompt-area p-4 text-sm text-slate-300 leading-relaxed font-mono min-h-[100px]">
          Loading prompt suggestion...
        </div>
      </div>
    </section>

    <!-- Quality Gates Log -->
    <section class="card-enter" style="animation-delay:0.25s">
      <div class="glass rounded-xl p-6 glass-hover">
        <h2 class="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-4">Quality Gate History</h2>
        <div id="gatesLog" class="space-y-2 max-h-48 overflow-y-auto">
          <p class="text-xs text-slate-600">No gate results yet.</p>
        </div>
      </div>
    </section>

    <!-- Live Console -->
    <section class="card-enter" style="animation-delay:0.3s">
      <div class="glass rounded-xl overflow-hidden glass-hover">
        <div class="px-5 py-3 border-b border-slate-800/50 flex items-center gap-2">
          <div class="flex gap-1.5">
            <div class="w-3 h-3 rounded-full bg-red-500/80"></div>
            <div class="w-3 h-3 rounded-full bg-yellow-500/80"></div>
            <div class="w-3 h-3 rounded-full bg-green-500/80"></div>
          </div>
          <span class="text-xs text-slate-500 font-medium ml-2">Live Console - orchestrator.ps1</span>
          <button onclick="clearConsole()" class="ml-auto text-xs text-slate-600 hover:text-slate-400 transition">Clear</button>
        </div>
        <div id="console" class="console-output p-4">
          <div class="text-slate-600">$ Awaiting commands...</div>
        </div>
      </div>
    </section>

  </main>

<script>
const STATES = ['INIT','PHASE_PLANNING','DETAILED_PLANNING','PLAN_REVIEW','EXECUTION','EXECUTION_REVIEW','ARCHIVE','COMPLETE'];
const STATE_LABELS = ['Init','Phase Plan','Detail Plan','Review','Execute','Exec Review','Archive','Complete'];
const PROMPTS = {
  'INIT': 'Please provide a feature request to the Director. Describe the feature you want built, including scope and success criteria.',
  'PHASE_PLANNING': 'Switch to Director mode. Read the feature request, WORKFLOW/LESSONS_LEARNED.md, and WORKFLOW/PHASE_DNA.md. Then generate WORKFLOW/ACTIVE/PHASE_PLAN.md with a high-level phase plan (max 10 lines per phase). When done, tell the user to run orchestrator.ps1 -Next.',
  'DETAILED_PLANNING': 'Switch to Planner mode. Read WORKFLOW/ACTIVE/PHASE_PLAN.md, WORKFLOW/LESSONS_LEARNED.md, and all relevant project files. Generate WORKFLOW/ACTIVE/DETAILED_PLAN.md with full implementation steps, file list, risk assessments, and test plan. When done, tell the user to run orchestrator.ps1 -Next.',
  'PLAN_REVIEW': 'Switch to Director mode. Read WORKFLOW/ACTIVE/DETAILED_PLAN.md and evaluate it. Write WORKFLOW/ACTIVE/PLAN_REVIEW.md with STATUS: APPROVED or NEEDS_REVISION. If approved, copy DETAILED_PLAN.md to PLAN_APPROVED.md. When done, tell the user to run orchestrator.ps1 -Next.',
  'EXECUTION': 'Switch to Executor mode. Read WORKFLOW/ACTIVE/PLAN_APPROVED.md and implement EXACTLY what is planned. Run tests after every change. Write WORKFLOW/ACTIVE/EXECUTION_REPORT.md with results. When done, tell the user to run orchestrator.ps1 -Next.',
  'EXECUTION_REVIEW': 'Switch to Director mode. Read WORKFLOW/ACTIVE/EXECUTION_REPORT.md. FIRST update LESSONS_LEARNED.md and PHASE_DNA.md with learnings. THEN write WORKFLOW/ACTIVE/EXECUTION_REVIEW.md with STATUS: APPROVED or NEEDS_REVISION. When done, tell the user to run orchestrator.ps1 -Next.',
  'ARCHIVE': 'Switch to Director mode. Read all WORKFLOW/ACTIVE/*.md files. Verify LESSONS_LEARNED.md and PHASE_DNA.md are up to date. Do NOT move files. Then tell the user to run orchestrator.ps1 -Next.',
  'COMPLETE': '[OK] Workflow complete! All files have been archived. Use "Reset Workflow" to start a new feature cycle.'
};

let currentState = 'INIT';
let pollTimer = null;

// Build stepper
function buildStepper(activeState) {
  const container = document.getElementById('stepper');
  container.innerHTML = '';
  const idx = STATES.indexOf(activeState);
  STATES.forEach((s, i) => {
    const dot = document.createElement('div');
    dot.className = 'step-dot ' + (i < idx ? 'done' : i === idx ? 'active' : 'pending');
    dot.innerHTML = `<span>${i < idx ? 'OK' : (i + 1)}</span>`;
    dot.title = s;
    const label = document.createElement('div');
    label.className = 'flex flex-col items-center gap-1.5 shrink-0';
    label.appendChild(dot);
    const txt = document.createElement('span');
    txt.className = 'text-[10px] font-semibold tracking-wide ' + (i === idx ? 'text-indigo-400' : i < idx ? 'text-emerald-500' : 'text-slate-600');
    txt.textContent = STATE_LABELS[i];
    label.appendChild(txt);
    container.appendChild(label);
    if (i < STATES.length - 1) {
      const conn = document.createElement('div');
      conn.className = 'step-connector ' + (i < idx ? 'done' : i === idx ? 'active' : 'pending');
      container.appendChild(conn);
    }
  });
}

function getStatusColor(status) {
  if (status === 'BLOCKED') return 'bg-red-500/20 text-red-400';
  if (status === 'COMPLETE') return 'bg-emerald-500/20 text-emerald-400';
  return 'bg-indigo-500/20 text-indigo-400';
}

function formatDate(iso) {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function getElapsed(iso) {
  if (!iso) return '';
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(ms / 60000);
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) return `${hrs}h ${mins % 60}m elapsed`;
    return `${mins}m elapsed`;
  } catch { return ''; }
}

async function pollStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    const state = data['Current State'] || 'INIT';
    currentState = state;
    buildStepper(state);
    document.getElementById('metricState').textContent = state.replace(/_/g, ' ');
    const status = data['Status'] || 'IN_PROGRESS';
    const badge = document.getElementById('statusBadge');
    badge.textContent = status;
    badge.className = 'mt-2 inline-block status-badge ' + getStatusColor(status);
    document.getElementById('metricCycleStart').textContent = formatDate(data['Cycle Start']);
    document.getElementById('metricElapsed').textContent = getElapsed(data['Cycle Start']);
    document.getElementById('metricTransitions').textContent = data['Transition Count'] || '0';
    document.getElementById('metricRetries').textContent = data['Retry Count'] || '0';
    document.getElementById('promptArea').textContent = PROMPTS[state] || 'No prompt available for this state.';
    // Blocked alert
    const blockedAlert = document.getElementById('blockedAlert');
    const blockedReason = data['Blocked Reason'] || '';
    if (status === 'BLOCKED') {
      blockedAlert.classList.remove('hidden');
      document.getElementById('blockedReason').textContent = blockedReason || 'No reason specified.';
    } else {
      blockedAlert.classList.add('hidden');
    }
    // Autopilot Toggle Update
    const toggle = document.getElementById('autopilotToggle');
    const autopilotState = data['Autopilot'] || 'OFF';
    if (toggle.dataset.updating !== 'true') {
      toggle.checked = autopilotState === 'ON';
    }
    // Restore connection indicator
    document.getElementById('connectionDot').className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-lg shadow-emerald-400/50 animate-pulse';
  } catch (e) {
    document.getElementById('connectionDot').className = 'w-2.5 h-2.5 rounded-full bg-red-400 shadow-lg shadow-red-400/50';
  }
}

function appendConsole(text, isError) {
  const el = document.getElementById('console');
  const line = document.createElement('div');
  line.className = isError ? 'text-red-400' : 'text-emerald-400';
  line.textContent = text;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function setButtonLoading(btn, loading) {
  if (loading) {
    btn.classList.add('btn-loading');
    btn.querySelector('span').textContent = 'Running...';
  } else {
    btn.classList.remove('btn-loading');
  }
}

async function triggerNext() {
  const btn = document.getElementById('btnNext');
  setButtonLoading(btn, true);
  document.getElementById('actionFeedback').textContent = 'Executing orchestrator -Next...';
  appendConsole('$ powershell.exe orchestrator.ps1 -Next', false);
  try {
    const res = await fetch('/api/next', { method: 'POST' });
    const data = await res.json();
    if (data.stdout) appendConsole(data.stdout, false);
    if (data.stderr) appendConsole(data.stderr, true);
    if (data.error) appendConsole('ERROR: ' + data.error, true);
    document.getElementById('actionFeedback').textContent = data.success ? 'Transition complete OK' : 'Transition failed X';
    await pollStatus();
  } catch (e) {
    appendConsole('Network error: ' + e.message, true);
    document.getElementById('actionFeedback').textContent = 'Network error';
  }
  setButtonLoading(btn, false);
  btn.querySelector('span').textContent = 'Next Phase';
}

async function triggerReset() {
  if (!confirm('Reset workflow to INIT? This will clean all files in ACTIVE/ except QUALITY_GATES.md.')) return;
  const btn = document.getElementById('btnReset');
  setButtonLoading(btn, true);
  document.getElementById('actionFeedback').textContent = 'Executing orchestrator -Reset...';
  appendConsole('$ powershell.exe orchestrator.ps1 -Reset', false);
  try {
    const res = await fetch('/api/reset', { method: 'POST' });
    const data = await res.json();
    if (data.stdout) appendConsole(data.stdout, false);
    if (data.stderr) appendConsole(data.stderr, true);
    if (data.error) appendConsole('ERROR: ' + data.error, true);
    document.getElementById('actionFeedback').textContent = data.success ? 'Reset complete OK' : 'Reset failed X';
    await pollStatus();
  } catch (e) {
    appendConsole('Network error: ' + e.message, true);
  }
  setButtonLoading(btn, false);
  btn.querySelector('span').textContent = 'Reset Workflow';
}

function copyPrompt() {
  const text = document.getElementById('promptArea').textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copyBtn');
    btn.classList.add('copied');
    btn.querySelector('span').textContent = 'Copied!';
    setTimeout(() => { btn.classList.remove('copied'); btn.querySelector('span').textContent = 'Copy'; }, 2000);
  });
}

function clearConsole() {
  document.getElementById('console').innerHTML = '<div class="text-slate-600">$ Console cleared.</div>';
}

async function triggerUndo() {
  const btn = document.getElementById('btnUndo');
  setButtonLoading(btn, true);
  document.getElementById('actionFeedback').textContent = 'Executing orchestrator -Undo...';
  appendConsole('$ powershell.exe orchestrator.ps1 -Undo', false);
  try {
    const res = await fetch('/api/undo', { method: 'POST' });
    const data = await res.json();
    if (data.stdout) appendConsole(data.stdout, false);
    if (data.stderr) appendConsole(data.stderr, true);
    if (data.error) appendConsole('ERROR: ' + data.error, true);
    document.getElementById('actionFeedback').textContent = data.success ? 'Rollback complete OK' : 'Rollback failed X';
    await pollStatus();
  } catch (e) {
    appendConsole('Network error: ' + e.message, true);
  }
  setButtonLoading(btn, false);
  btn.querySelector('span').textContent = 'Undo';
}

async function triggerResume() {
  const btn = document.getElementById('btnResume');
  btn.style.opacity = '0.7';
  btn.style.pointerEvents = 'none';
  btn.querySelector('span').textContent = 'Running...';
  document.getElementById('actionFeedback').textContent = 'Executing orchestrator -Resume...';
  appendConsole('$ powershell.exe orchestrator.ps1 -Resume', false);
  try {
    const res = await fetch('/api/resume', { method: 'POST' });
    const data = await res.json();
    if (data.stdout) appendConsole(data.stdout, false);
    if (data.stderr) appendConsole(data.stderr, true);
    if (data.error) appendConsole('ERROR: ' + data.error, true);
    document.getElementById('actionFeedback').textContent = data.success ? 'Resume complete OK' : 'Resume failed X';
    await pollStatus();
  } catch (e) {
    appendConsole('Network error: ' + e.message, true);
  }
  btn.style.opacity = '1';
  btn.style.pointerEvents = 'auto';
  btn.querySelector('span').textContent = 'Resume';
}

async function toggleAutopilot() {
  const toggle = document.getElementById('autopilotToggle');
  const newState = toggle.checked ? 'ON' : 'OFF';
  toggle.dataset.updating = 'true'; // Prevent pollStatus from overriding during update
  
  try {
    const res = await fetch('/api/autopilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: newState })
    });
    if (!res.ok) throw new Error('Failed to toggle autopilot');
    document.getElementById('actionFeedback').textContent = `Autopilot turned ${newState}`;
  } catch (e) {
    toggle.checked = !toggle.checked; // Revert
    document.getElementById('actionFeedback').textContent = 'Error toggling autopilot';
  } finally {
    setTimeout(() => { toggle.dataset.updating = 'false'; }, 500);
  }
}

async function fetchGates() {
  try {
    const res = await fetch('/api/quality-gates');
    const data = await res.json();
    const container = document.getElementById('gatesLog');
    if (!data.gates || data.gates.length === 0) {
      container.innerHTML = '<p class="text-xs text-slate-600">No gate results yet.</p>';
      return;
    }
    container.innerHTML = data.gates.slice(-10).reverse().map(g => {
      const isPass = g.result && g.result.includes('PASS');
      const color = isPass ? 'text-emerald-400' : 'text-red-400';
      const icon = isPass ? 'OK' : 'X';
      return `<div class="flex items-center gap-3 text-xs py-1.5 border-b border-slate-800/30">
        <span class="${color} font-bold w-4">${icon}</span>
        <span class="text-slate-500 w-28 shrink-0">${g.timestamp || ''}</span>
        <span class="text-slate-300 flex-1">${g.gate || ''}</span>
        <span class="text-slate-500">${g.notes || ''}</span>
      </div>`;
    }).join('');
  } catch(e) {}
}

// Init
buildStepper('INIT');
pollStatus();
fetchGates();
pollTimer = setInterval(() => { pollStatus(); fetchGates(); }, 2000);
</script>
</body>
</html>
'@


$PackageJsonContent = @'
{
  "name": "workflow-dashboard",
  "version": "1.0.0",
  "description": "Workflow Command Center",
  "main": "server.js",
  "scripts": { "start": "node server.js" },
  "dependencies": { "cors": "^2.8.5", "express": "^4.18.2" }
}
'@

if (-not $SkipDashboard) {
    Write-Host "`n8. Setting up Command Center Dashboard..." -ForegroundColor Yellow

    # Three cases to consider:
    #   1. Live dashboard exists at $scriptDir/workflow-dashboard AND target is a different
    #      directory  -> copy from source to target.
    #   2. Live dashboard exists AND target IS the same directory (the common case when
    #      init-workflow.ps1 is run from inside the cloned repo) -> files are already in
    #      place; do NOT overwrite (especially do NOT fall back to the stale embedded
    #      copies, which would degrade the dashboard).
    #   3. No live dashboard source anywhere -> fall back to embedded literals.
    $liveDashboardDir = Join-Path $scriptDir "workflow-dashboard"
    $liveDashboardServerJs = Join-Path $liveDashboardDir "server.js"
    $liveSourceExists = Test-Path $liveDashboardServerJs

    if (-not (Test-Path "workflow-dashboard/public")) {
        New-Item -ItemType Directory -Force -Path "workflow-dashboard/public" | Out-Null
        Write-Host "  CREATED: workflow-dashboard/" -ForegroundColor Green
        Write-Host "  CREATED: workflow-dashboard/public/" -ForegroundColor Green
    }

    # Compare resolved paths to decide between case 1 and case 2.
    $targetDashboardResolved = (Resolve-Path "workflow-dashboard" -ErrorAction SilentlyContinue)
    $sameLocation = $false
    if ($liveSourceExists -and $targetDashboardResolved) {
        try {
            $liveResolved = (Resolve-Path $liveDashboardDir).Path
            $targetResolved = $targetDashboardResolved.Path
            if ([string]::Equals($liveResolved.TrimEnd('\','/'), $targetResolved.TrimEnd('\','/'), [StringComparison]::OrdinalIgnoreCase)) {
                $sameLocation = $true
            }
        } catch { }
    }

    if ($liveSourceExists -and $sameLocation) {
        # Case 2: already in place — leave the live files alone.
        Write-Host "  Live dashboard already in place at workflow-dashboard/ (no copy needed)." -ForegroundColor Green
    }
    elseif ($liveSourceExists) {
        # Case 1: copy live source into target.
        Write-Host "  Using live dashboard from $liveDashboardDir (overrides embedded copies)" -ForegroundColor Green
        Copy-Item -Path $liveDashboardServerJs                          -Destination "workflow-dashboard/server.js"     -Force
        Copy-Item -Path (Join-Path $liveDashboardDir "package.json")    -Destination "workflow-dashboard/package.json"  -Force
        $livePublic = Join-Path $liveDashboardDir "public"
        if (Test-Path $livePublic) {
            Copy-Item -Path (Join-Path $livePublic "*") -Destination "workflow-dashboard/public/" -Recurse -Force
        }
        Write-Host "  COPIED: workflow-dashboard/server.js" -ForegroundColor Green
        Write-Host "  COPIED: workflow-dashboard/public/" -ForegroundColor Green
        Write-Host "  COPIED: workflow-dashboard/package.json" -ForegroundColor Green
    }
    else {
        # Case 3: no live source anywhere — embedded fallback.
        Write-Host "  No live dashboard source found; falling back to embedded copies." -ForegroundColor Yellow
        Set-Content -Path "workflow-dashboard/server.js" -Value $ServerJsContent -Encoding UTF8
        Write-Host "  CREATED: workflow-dashboard/server.js (embedded fallback)" -ForegroundColor Green

        Set-Content -Path "workflow-dashboard/public/index.html" -Value $IndexHtmlContent -Encoding UTF8
        Write-Host "  CREATED: workflow-dashboard/public/index.html (embedded fallback)" -ForegroundColor Green

        Set-Content -Path "workflow-dashboard/package.json" -Value $PackageJsonContent -Encoding UTF8
        Write-Host "  CREATED: workflow-dashboard/package.json (embedded fallback)" -ForegroundColor Green
    }
    
    Write-Host "  Installing npm dependencies..." -ForegroundColor Gray
    Push-Location "workflow-dashboard"
    try {
        & npm install --silent 2>&1 | Out-Null
        Write-Host "  INSTALLED: npm packages" -ForegroundColor Green
    }
    catch {
        Write-Host "  WARNING: npm install failed. Run manually: cd workflow-dashboard ; npm install" -ForegroundColor Red
    }
    Pop-Location
} else {
    Write-Host "
6. Skipping dashboard (use -SkipDashboard to skip)" -ForegroundColor Gray
}


# --- Summary ------------------------------------------------------------------

Write-Host "`n==================================================" -ForegroundColor Green
Write-Host "   [OK] Workflow setup complete!                     " -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Quick Start:" -ForegroundColor White
Write-Host "    1. .\orchestrator.ps1 -Next        # Start the workflow" -ForegroundColor Gray
Write-Host "    2. Switch to Director mode in Roo Code" -ForegroundColor Gray
Write-Host "    3. Give your feature request" -ForegroundColor Gray
Write-Host ""
Write-Host "  Commands:" -ForegroundColor White
Write-Host "    .\orchestrator.ps1 -Status          # Check status" -ForegroundColor Gray
Write-Host "    .\orchestrator.ps1 -Next            # Advance state" -ForegroundColor Gray
Write-Host "    .\orchestrator.ps1 -Undo            # Roll back" -ForegroundColor Gray
Write-Host "    .\orchestrator.ps1 -Reset           # Full reset" -ForegroundColor Gray
Write-Host ""

if (-not $SkipDashboard -and (Test-Path "workflow-dashboard/server.js")) {
    Write-Host "  Dashboard:" -ForegroundColor White
    Write-Host "    cd workflow-dashboard && npm start  # http://localhost:3000" -ForegroundColor Gray
    Write-Host ""
}

