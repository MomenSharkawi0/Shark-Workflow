# Roo Code V3 Orchestration Workflow Manual

Welcome to the definitive guide for the **Roo Code V3 Orchestration Workflow**. This architecture transforms Roo Code into a highly structured, self-documenting, and fully autonomous software factory. By enforcing strict separation of concerns, persistent memory, and rigorous quality gates, it eliminates AI context loss and hallucination-driven errors.

---

## 1. System Overview & Architecture

The V3 Workflow relies on a rigid **State Machine** managed by PowerShell (`orchestrator.ps1`), a **Web Dashboard** for real-time monitoring, and specialized **AI Modes** that handle distinct responsibilities.

### The 8-Step Pipeline
The workflow enforces a strict sequential pipeline that cannot be bypassed manually (unless using specific advanced commands):
1. **INIT:** Awaiting the initial user feature request.
2. **PHASE_PLANNING:** The Director defines *what* is being built, updating architectural memory.
3. **DETAILED_PLANNING:** The Planner defines exactly *how* it will be built (files to modify, steps).
4. **PLAN_REVIEW:** The Director evaluates the plan against past lessons and approves it.
5. **EXECUTION:** The Executor implements the approved plan and runs automated tests.
6. **EXECUTION_REVIEW:** The Director reviews the code, extracts new learnings, and approves the phase.
7. **ARCHIVE:** Completed files are copied to the `HISTORY/` folder, and the `ACTIVE/` workspace is cleaned.
8. **COMPLETE:** The workflow cycle ends, ready for a new feature request.

### Separation of Concerns (Modes)
- **Director:** The architect. It writes high-level phase plans, reviews plans/code, updates long-term memory, and acts as the gatekeeper. *Never writes code.*
- **Planner:** The engineer. It reads the Phase Plan and writes a step-by-step technical implementation plan. *Never writes code.*
- **Executor:** The developer. It follows the Detailed Plan precisely, modifies files, and runs tests. *Never alters the plan or architectural memory.*
- **Workflow Master:** The fully autonomous mode that dynamically shapeshifts into the Director, Planner, or Executor depending on the current state, running the entire pipeline without human intervention.

### The Command Center Dashboard
A local Node.js web dashboard (`workflow-dashboard/`) provides real-time visibility into the system state, cycle time, quality gate results, and live orchestrator terminal logs.

---

## 2. Core Concepts

### Persistent Memory System
The biggest limitation of AI coding is context drift. V3 solves this using the `WORKFLOW/` directory:
- **`PHASE_DNA.md`**: Contains "Active Memory", documenting the current state of the application (e.g., active database models, specific package versions, credentials).
- **`LESSONS_LEARNED.md`**: A growing encyclopedia of bugs, gotchas, and specific fixes discovered in past phases. The AI is forced to read this before every single step to avoid repeating mistakes.

### History Archiving (Copy & Clear)
To prevent token bloat, the `ACTIVE/` directory is kept pristine. During the `ARCHIVE` state, all planning and review files are stamped with timestamps and copied to `HISTORY/`. The orchestrator then programmatically deletes the files from the `ACTIVE/` folder, ensuring the AI enters the next phase with a clean slate.

### Regex Quality Gates
Transitions between states require specific files to exist, and they must contain specific formatting (e.g., `STATUS: APPROVED`, `## Implementation Steps`). If the AI writes a sloppy plan, the `orchestrator.ps1` will literally reject the state transition and force the AI to try again.

### Global 5-Strike Retry Limit
The **Executor** is bound by a strict limit:
- It gets 2 attempts to fix any specific bug.
- It gets a maximum of 5 total failures/retries across the entire `EXECUTION` phase.
- If it fails 5 times, it is forced to STOP coding, write an `ESCALATION.md` file, and halt the system. This prevents infinite looping and code destruction.

---

## 3. Advanced Features

### ✈️ Autopilot & Workflow Master
You can toggle between **Manual Mode** and **Full Autonomy** directly from the Web Dashboard toggle switch.
- **When Autopilot is OFF:** The Agent will write its plan/code and then STOP, waiting for you to click "Next Phase" in the dashboard.
- **When Autopilot is ON:** The Workflow Master mode will automatically execute `.\orchestrator.ps1 -Next`, read the output, switch personas, and immediately continue to the next phase without pausing.
- **Requirement:** For true autonomy, you MUST go to your Roo Code settings and enable **"Always approve terminal commands"**.

### ⏩ Fast-Tracking with `-InjectPlan`
If you generated a detailed implementation plan using an external tool (like ChatGPT) or wrote one yourself, you can inject it directly into the workflow, completely bypassing the Director and Planner phases:
```powershell
.\orchestrator.ps1 -InjectPlan "C:\path\to\your_plan.md"
```
This automatically formats your plan, satisfies Quality Gates 1, 2, and 3 instantly, and jumps the system directly to the `EXECUTION` phase.

### 🏷️ Technology Tagging
In a complex stack (e.g., a Laravel + Flutter Monorepo), the `LESSONS_LEARNED.md` file enforces strict tagging.
- Agents must tag entries: `[LARAVEL] Form validation failed...`, `[FLUTTER] Widget state error...`
- The Planner and Executor are instructed to filter these lessons by relevant tags, preventing backend rules from polluting frontend logic.

---

## 4. Step-by-Step Guide: Starting a Brand New Project

1. **Initialize the Workspace:**
   Open your empty project folder in VS Code. Run the bootstrap script to scaffold the entire architecture:
   ```powershell
   .\init-workflow.ps1
   ```
2. **Start the Dashboard:**
   ```powershell
   cd workflow-dashboard
   npm install
   npm start
   ```
   Open `http://localhost:3000` in your browser.
3. **Begin the Workflow:**
   - In VS Code, select the **Workflow Master** mode.
   - Run `.\orchestrator.ps1 -Next` in your terminal (or click "Next Phase" in the dashboard).
   - Give the Workflow Master your initial prompt: *"Build a simple to-do application with user authentication."*
   - Toggle **Autopilot ON** and watch it build.

---

## 5. Step-by-Step Guide: Integrating into an Existing Project (Legacy Code)

Integrating the V3 Workflow into a pre-existing codebase requires an initial "Discovery" phase to align the AI.

1. **Bootstrap:**
   Run `.\init-workflow.ps1` in the root of your existing project.
2. **Configure Monorepo (If Applicable):**
   Open the `.roorules` file and explicitly define directory boundaries. Example:
   ```markdown
   - Backend Commands: Must run inside `/backend`
   - Frontend Commands: Must run inside `/mobile`
   ```
3. **The Discovery Phase (Crucial!):**
   Do not ask the AI to build features yet. Open the **Director** mode and issue this prompt:
   > *"We are integrating this workflow into an existing legacy project. Please perform a deep audit of the codebase. Document the current architecture, database schema, package versions, and folder structure in `WORKFLOW/PHASE_DNA.md`. Let me know when the DNA is fully mapped."*
4. **Commence Feature Development:**
   Once `PHASE_DNA.md` accurately reflects your legacy code, you can switch to the Workflow Master and begin requesting new features.

---

## 6. Troubleshooting & Best Practices

### State Machine Recovery
If the AI hallucinates, creates a bad file, or fails a Quality Gate, the dashboard will warn you. 
- **Rollback:** To undo the last transition and return to the previous state, click "Undo" in the dashboard or run:
  ```powershell
  .\orchestrator.ps1 -Undo
  ```
- **Nuclear Reset:** If the `ACTIVE/` directory is completely ruined and you want to abandon the current feature attempt, click "Reset" or run:
  ```powershell
  .\orchestrator.ps1 -Reset
  ```
  This returns the state to `INIT` and safely deletes all active, unapproved plans.

### Best Practices
- **Never edit `ORCHESTRATION_STATUS.json` manually.** Let the script handle state transitions.
- **Keep `PHASE_DNA.md` pruned.** If you delete an old feature from your codebase, manually ensure the Director removes it from the DNA.
- **Trust the 5-Strike Rule.** If the Executor hits 5 strikes and halts, *do not force it to keep trying.* Switch to manual mode, use your own expertise to fix the bug, and update `LESSONS_LEARNED.md` before resuming the workflow.
