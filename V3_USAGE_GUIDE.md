# Roo Workflow Orchestrator v3 — Complete Usage Guide

## 1. How the Workflow Works

The V3 workflow is an 8-stage state machine that turns Roo Code into a structured software factory with specialized AI roles (Director, Planner, Executor) and automated quality gates.

```
INIT → PHASE_PLANNING → DETAILED_PLANNING → PLAN_REVIEW → EXECUTION → EXECUTION_REVIEW → ARCHIVE → COMPLETE
```

**The state machine is embedded in the PowerShell orchestrator (`orchestrator.ps1`)**. The Roo Code fork integration (optional) adds auto mode-switching, a status bar, and context injection.

---

## 2. Setup in Your Project (With the Modified Fork)

### Step 1: Run the Bootstrap Script

In your project root (e.g., `C:\Users\Administrator\Documents\New_Workflow`):

```powershell
.\init-workflow.ps1
```

This creates:
- `WORKFLOW/ORCHESTRATION_STATUS.json` — the machine-managed state file
- `WORKFLOW/MANIFEST.json` — version tracking
- `WORKFLOW/workflow-config.json` — system-wide configuration
- `WORKFLOW/METRICS.json` — cycle analytics data
- `WORKFLOW/LESSONS_LEARNED.md` — persistent AI memory
- `WORKFLOW/PHASE_DNA.md` — architectural context
- `WORKFLOW/GOLDEN_RULES.md` — high-confidence graduated rules
- `WORKFLOW/ACTIVE/` — where plans and reports live during a cycle
- `WORKFLOW/HISTORY/` — archived files from completed cycles
- `.roo/rules/` — Agent rules for Director, Planner, Executor, Workflow Master
- `.roomodes` — Custom mode definitions
- `.roorules` — Global autopilot protocol

### Step 2: Build and Install the Modified Roo Code Extension

From the fork directory:

```powershell
cd C:\Users\Administrator\Documents\roo-code-fork

# Install dependencies (first time only)
pnpm install

# Build the VSIX package
pnpm install:vsix --editor=code
```

This generates a `.vsix` file in the `releases/` directory.

### Step 3: Install the VSIX in VS Code

1. Open VS Code
2. Press `Ctrl+Shift+P` → "Extensions: Install from VSIX..."
3. Select the generated `.vsix` file
4. Restart VS Code

### Step 4: Start the Dashboard

```powershell
cd workflow-dashboard
npm start
```

Open `http://localhost:3000` in your browser.

---

## 3. Running a Workflow Cycle

### Option A: Fully Manual (No Fork Needed)

Without the fork modification, you manually switch modes between each step:

1. Run `.\orchestrator.ps1 -Next`
2. Switch to **Director** mode
3. Write `WORKFLOW/ACTIVE/PHASE_PLAN.md`
4. Run `.\orchestrator.ps1 -Next`
5. Switch to **Planner** mode
6. Write `WORKFLOW/ACTIVE/DETAILED_PLAN.md`
7. Run `.\orchestrator.ps1 -Next`
8. Switch to **Director** mode (review)
9. Write `WORKFLOW/ACTIVE/PLAN_REVIEW.md` with `STATUS: APPROVED`
10. Run `.\orchestrator.ps1 -Next`
11. Switch to **Executor** mode
12. Implement the code
13. Write `WORKFLOW/ACTIVE/EXECUTION_REPORT.md`
14. Run `.\orchestrator.ps1 -Next`
15. ...and so on through EXECUTION_REVIEW, ARCHIVE, COMPLETE

### Option B: Autopilot Mode (With Fork)

If you built and installed the fork:

1. Toggle **Autopilot ON** in the dashboard (or edit the JSON directly)
2. **The Workflow Master mode** will automatically:
   - Detect state changes in `ORCHESTRATION_STATUS.json`
   - Switch to the correct persona (Director/Planner/Executor)
   - Auto-inject relevant context files
   - Execute `orchestrator.ps1 -Next` after completing each phase
   - Continue without pausing until COMPLETE or BLOCKED

### Option C: Plan Wizard (Quick Start)

```powershell
.\orchestrator.ps1 -Plan
```

This interactive wizard prompts for feature description, stack, and complexity, then auto-generates the initial plan skeleton.

### Option D: Inject External Plan

```powershell
.\orchestrator.ps1 -InjectPlan "C:\path\to\plan.md"
```

This bypasses the planning phases and jumps directly to EXECUTION.

---

## 4. Orchestrator Commands

| Command | Purpose |
|---------|---------|
| `.\orchestrator.ps1 -Status` | Show current state and metrics |
| `.\orchestrator.ps1 -Next` | Advance to the next state (validates quality gates) |
| `.\orchestrator.ps1 -Undo` | Roll back to the previous state (also restores file snapshots) |
| `.\orchestrator.ps1 -Reset` | Reset to INIT and clean ACTIVE directory |
| `.\orchestrator.ps1 -Resume` | Reset retry count to 0 and re-enter EXECUTION |
| `.\orchestrator.ps1 -Plan` | Launch the interactive plan wizard |
| `.\orchestrator.ps1 -InjectPlan "path"` | Bypass planning, jump to EXECUTION |
| `.\orchestrator.ps1 -SkipGit` | Skip git commit for this transition only |

---

## 5. Key Features

### JSON State File (`WORKFLOW/ORCHESTRATION_STATUS.json`)
No more fragile regex parsing. The dashboard and the Roo Code fork read this directly with `JSON.parse()`.

### Git Integration
Every successful state transition creates a commit and tag:
```
chore(workflow): [PLAN_REVIEW -> EXECUTION] Phase: Inventory Module | Cycle: 4
Tag: workflow/20260425_191200/EXECUTION
```

### Pre-flight Gate 0
Before EXECUTION starts, the orchestrator checks:
- ACTIVE directory exists
- PLAN_APPROVED.md exists
- `.env` file (Laravel projects)
- `npm` dependency status (Node projects)

### File Snapshots
Before EXECUTION, all files listed in PLAN_APPROVED.md are snapshot. If `-Undo` is used, you're prompted to restore them.

### Webhook Notifications
Set an environment variable to get Slack/Discord notifications:
```powershell
$env:ROO_WEBHOOK_URL = "https://hooks.slack.com/services/..."
```

### Quality Gates History
Every gate result is logged in `WORKFLOW/QUALITY_DASHBOARD.md` and served via the `/api/quality-gates` endpoint.

### Cycle Metrics
Each completed cycle is recorded in `WORKFLOW/METRICS.json` with duration, transitions, and status.

---

## 6. File Structure Summary

```
YOUR_PROJECT/
├── orchestrator.ps1          # State machine engine
├── init-workflow.ps1          # Bootstrap script
├── workflow-dashboard/        # Web UI (Node.js)
│   ├── server.js
│   └── public/index.html
├── WORKFLOW/
│   ├── ORCHESTRATION_STATUS.json   # State (machine-managed)
│   ├── MANIFEST.json               # Version tracking
│   ├── METRICS.json                # Cycle analytics
│   ├── LESSONS_LEARNED.md          # AI memory
│   ├── PHASE_DNA.md                # Architecture context
│   ├── GOLDEN_RULES.md             # Graduated rules
│   ├── QUALITY_DASHBOARD.md        # Gate logs
│   ├── SELF_REVIEW_CHECKLIST.md    # Mode checklists
│   ├── ACTIVE/                     # Current cycle files
│   ├── HISTORY/                    # Archived cycles
│   └── SNAPSHOTS/                  # File backups
├── .roomodes                       # Custom mode definitions
├── .roorules                       # Global autopilot rules
└── .roo/rules/                     # Per-mode agent rules
```

```
ROO_CODE_FORK/
├── src/
│   └── workflow/                   # All custom integration code
│       ├── index.ts                # Single entry point
│       ├── WorkflowWatcher.ts      # Auto mode-switch
│       ├── WorkflowStatusBar.ts    # Status bar
│       ├── ContextInjector.ts      # Context injection
│       └── GateValidator.ts        # In-editor gate checks
└── src/
    └── extension.ts                # One-line hook added
```

---

## 7. Rebuilding & Reinstalling After Changes

If you modify the fork source code, rebuild:

```powershell
cd C:\Users\Administrator\Documents\roo-code-fork

# Quick rebuild (for development)
pnpm compile

# Full VSIX package
pnpm install:vsix --editor=code
```

To upgrade: install the new VSIX over the old one — VS Code handles the update.

To revert to the official Roo Code: uninstall the VSIX and install from the marketplace.

---

## 8. Fork Upstream Sync

To pull official Roo Code updates without losing your custom code:

```powershell
cd C:\Users\Administrator\Documents\roo-code-fork
git remote add upstream https://github.com/RooCodeInc/Roo-Code.git
git fetch upstream
git merge upstream/main
```

Because all custom code is in `src/workflow/` and the only modification to existing files is a single import line in `extension.ts`, merge conflicts are minimized.

---

## 9. Troubleshooting

| Problem | Solution |
|---------|----------|
| `ORCHESTRATION_STATUS.json` not found | Run `.\init-workflow.ps1` first |
| Quality gate fails | Check the expected file exists in `WORKFLOW/ACTIVE/` and has the required sections |
| Dashboard shows no data | Ensure `npm start` is running in `workflow-dashboard/` |
| Fork extension not loading | Run `pnpm install` then `pnpm vsix:install` in the fork directory |
| "Not a git repository" warning | Run `git init` or use `-SkipGit` |
| Webhook not sending | Set `$env:ROO_WEBHOOK_URL` to a valid Slack/Discord webhook URL |
