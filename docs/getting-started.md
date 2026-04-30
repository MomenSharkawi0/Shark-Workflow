# Roo Code Workflow — Getting Started

## Prerequisites

- **VS Code** or **Cursor** (with Roo Code extension or fork)
- **PowerShell 5.1+** (included with Windows)
- **Node.js 18+** (for the dashboard)
- **Git** (recommended, for automatic commit tracking)

## Quick Start (New Project)

### 1. Bootstrap the Workflow
```powershell
# Copy init-workflow.ps1 and orchestrator.ps1 to your project root
.\init-workflow.ps1
```

This creates:
- `WORKFLOW/` — Persistent memory, status, metrics
- `.roo/rules/` — Agent mode instructions
- `.roomodes` — Custom mode definitions
- `.roorules` — Global autonomy protocol

### 2. Start the Dashboard
```powershell
cd workflow-dashboard
npm install
npm start
```
Open `http://localhost:3000` in your browser.

### 3. Begin a Feature Cycle

1. Open VS Code/Cursor
2. Select **Workflow Master** mode
3. Run `.\orchestrator.ps1 -Next` in the terminal
4. Give the agent your feature request
5. Toggle **Autopilot ON** in the dashboard for full autonomy

## Quick Start (Existing Project)

1. Run `.\init-workflow.ps1` in your project root
2. Open the **Director** mode
3. Ask: *"Perform a deep audit of the codebase. Document the architecture in WORKFLOW/PHASE_DNA.md."*
4. Once DNA is mapped, begin normal feature cycles

## CLI Reference

| Command | Action |
|---------|--------|
| `.\orchestrator.ps1 -Status` | Show current workflow state |
| `.\orchestrator.ps1 -Next` | Advance to next phase |
| `.\orchestrator.ps1 -Undo` | Rollback to previous state |
| `.\orchestrator.ps1 -Reset` | Reset to INIT (cleans ACTIVE/) |
| `.\orchestrator.ps1 -Resume` | Reset retry count, stay in EXECUTION |
| `.\orchestrator.ps1 -InjectPlan "path"` | Bypass planning, jump to EXECUTION |
| `.\orchestrator.ps1 -Plan` | Interactive plan wizard |
| `.\orchestrator.ps1 -SkipGit` | Skip git commit for this transition |

## Dashboard Controls

| Button | Action |
|--------|--------|
| **Next Phase** | Runs `orchestrator.ps1 -Next` |
| **Resume** | Runs `orchestrator.ps1 -Resume` |
| **Undo** | Runs `orchestrator.ps1 -Undo` |
| **Reset** | Runs `orchestrator.ps1 -Reset` |
| **Autopilot Toggle** | Enables/disables full autonomy |
| **Copy Prompt** | Copies the smart prompt for current phase |
