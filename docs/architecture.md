# Roo Code Workflow — Architecture

## System Overview

The Roo Code Workflow system is a multi-agent orchestration engine that enforces a structured development pipeline with quality gates, persistent memory, and autonomous capabilities.

```mermaid
graph TB
    subgraph "User Interface"
        DASH["Web Dashboard<br/>:3000"]
        CLI["orchestrator.ps1<br/>CLI"]
    end

    subgraph "Control Layer"
        SERVER["Express Server<br/>server.js"]
        BRIDGE["WorkflowBridge<br/>:3001 HTTP API"]
        ENGINE["WorkflowEngine<br/>State Machine"]
    end

    subgraph "Extension Layer"
        WATCHER["WorkflowWatcher<br/>File Observer"]
        STATUSBAR["WorkflowStatusBar<br/>VS Code UI"]
        INJECTOR["ContextInjector<br/>Prompt Builder"]
        GATE["GateValidator<br/>Quality Checks"]
        STACK["StackDetector<br/>Auto-Detection"]
    end

    subgraph "Agent Modes"
        DIR["Director<br/>Plans & Reviews"]
        PLAN["Planner<br/>Detailed Steps"]
        EXEC["Executor<br/>Implementation"]
        WM["Workflow Master<br/>Autonomous"]
    end

    subgraph "Persistent Storage"
        STATUS["ORCHESTRATION_STATUS.json"]
        DNA["PHASE_DNA.md"]
        LESSONS["LESSONS_LEARNED.md"]
        METRICS["METRICS.json"]
        HISTORY["HISTORY/"]
        ACTIVE["ACTIVE/"]
    end

    DASH --> SERVER --> CLI
    DASH --> BRIDGE
    BRIDGE --> ENGINE
    ENGINE --> STATUS
    WATCHER --> STATUS
    STATUSBAR --> STATUS
    INJECTOR --> DNA
    INJECTOR --> LESSONS
    GATE --> ACTIVE
    STACK -.-> ENGINE

    DIR --> ACTIVE
    PLAN --> ACTIVE
    EXEC --> ACTIVE
    WM --> CLI
```

## Data Flow

### State Transitions
```
INIT → PHASE_PLANNING → DETAILED_PLANNING → PLAN_REVIEW → EXECUTION → EXECUTION_REVIEW → ARCHIVE → COMPLETE
                              ↑ (NEEDS_REVISION)                           ↑ (NEEDS_REVISION)
```

### Port Allocation
| Port | Service | Purpose |
|------|---------|---------|
| 3000 | Express Dashboard | Web UI for monitoring |
| 3001 | WorkflowBridge | Extension ↔ Dashboard API |

### File Ownership
| File | Written By | Read By |
|------|-----------|---------|
| `ORCHESTRATION_STATUS.json` | orchestrator.ps1, WorkflowEngine | Dashboard, Watcher, StatusBar |
| `PHASE_PLAN.md` | Director | Planner, orchestrator |
| `DETAILED_PLAN.md` | Planner | Director, orchestrator |
| `PLAN_APPROVED.md` | Director | Executor |
| `EXECUTION_REPORT.md` | Executor | Director, orchestrator |
| `LESSONS_LEARNED.md` | Director | All modes |
| `PHASE_DNA.md` | Director, orchestrator | All modes |
| `METRICS.json` | orchestrator.ps1 | Dashboard |
