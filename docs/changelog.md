# Changelog

All notable changes to Roo Workflow are documented here.

## v3.2.0 — Hardening & Correctness (2026-04-30)

A focused bugfix and security release that closes 16 distinct defects identified in a thorough audit. **No breaking changes** for normal usage; if you were relying on a buggy behavior (e.g. snapshots restored to project root) the fix may behave differently.

### Bug fixes — orchestrator

- **(A1)** Bootstrap now writes `WORKFLOW/ORCHESTRATION_STATUS.json` instead of the legacy `.md` template the orchestrator never read. First-run no longer relies on a falls-through default.
- **(A2)** Agent rule files (`.roo/rules/*.md`, `.roomodes`, `.roorules`) all reference the JSON file with correct field names (`currentState`, `autopilot`).
- **(A3)** Quality Gates 2, 4, 4a, 4b previously used `(A|B)` regex but claimed "must contain A AND B" in error messages — they now correctly require **both** sections and name the missing one in the failure message.
- **(A4)** Snapshot file extraction is scoped to the `## Files to Modify` section only. Previous regex matched every cell in every markdown table, treating action verbs and risk labels as file paths.
- **(A5)** `Restore-Snapshot` now uses a manifest sidecar to put each file back at its **original directory**. Previously it copied everything to project root, silently overwriting unrelated files.
- **(A6)** `-Resume` PowerShell parser hazard fixed (`-TransitionCount [int]$x` → `([int]$x)`).
- **(A7)** Webhook payload no longer ships `ðŸ¤–` mojibake; replaced with ASCII tag.
- **(A8)** `METRICS.json` now records real `Retries`, `GateResults`, `FilesModified` (from `git diff --stat`). Previously hardcoded to empty/zero.
- **(A13)** **Hard 5-strike enforcement.** At the 5th retry the orchestrator writes `WORKFLOW/ACTIVE/ESCALATION.md`, marks status `BLOCKED`, fires the webhook, and refuses to advance. Previously honor-system only.
- **(A15)** Snapshots are tagged with `cycleId`. Restore prefers a same-cycle snapshot.
- **(A16)** `.execution_start_commit` pointer is cleaned on `-Reset` and after ARCHIVE → COMPLETE so cycle-N's diff doesn't include cycle-N-1's commits.
- **(A17, B3)** Replaced pre-existing mojibake (`â”€`) in pipeline display. Its U+201D smart-quote byte broke PowerShell 7's parser. The orchestrator now parses cleanly under PS 7.

### Schema & state

- **(B5)** Added `schemaVersion: 1` to status JSON. Status reads warn on a newer schema. New `cycleId` field (8-char UUID prefix) propagates through every transition, snapshot, metric, and history entry — enabling clean per-cycle audit.

### Bug fixes — dashboard

- **(A11)** `/api/autopilot` now acquires the orchestrator's file lock with stale-lock recovery, eliminating the race against in-flight `-Next` transitions.
- **(C1)** `/api/inject-plan` validates `fileName` against `^[A-Za-z0-9._-]+\.md$`, caps body at 512 KB, and confirms the resolved path stays inside `WORKFLOW/ACTIVE/`. Path traversal (`../../.env`), absolute paths, and non-`.md` extensions now return `400`.
- **(C2)** CORS restricted to localhost origins (any port). Cross-origin POST returns `403`. Server binds to `127.0.0.1` by default — set `HOST=0.0.0.0` to expose on LAN.

### Bootstrap

- **(A14)** `init-workflow.ps1` now prefers the live `workflow-dashboard/` directory shipped alongside it (copies real `server.js`/`public/`) and falls back to embedded literals only when no live source is found. Eliminates the silent-degradation problem where bootstrap shipped a stale dashboard.
- Bootstrap banner updated to "v3.2".
- `MANIFEST.json` now includes `schemaVersion`.

### Behavioural notes

- The orchestrator now **stops** at 5-strike rather than warning — make sure you're checking `WORKFLOW/ACTIVE/ESCALATION.md` if a workflow goes BLOCKED.
- Snapshots created before v3.2.0 will use the legacy leaf-only restore path with a `WARN` entry in the log.

---

## v3.1.0 — Phase 1 Professionalization (2026-04-26)

### Orchestrator (`orchestrator.ps1`)

- **Added:** Structured logging via `Write-Log` — output also written to `WORKFLOW/orchestrator.log`
- **Added:** Atomic JSON writes via `Invoke-AtomicJsonWrite` — writes to `.tmp` then renames
- **Added:** File-based locking via `Invoke-Lock`/`Invoke-Unlock` to prevent concurrent runs
- **Added:** Stale-lock auto-removal after 60 seconds
- **Changed:** Console output standardised to `[OK]`, `[WARN]`, `[FAIL]`, `[INFO]`, `[SKIP]`, `[GIT]`, `[GATE]` prefixes
- **Changed:** Lock acquired only for state-modifying operations
- **Changed:** Lock always released in `finally`, even on error

### Dashboard (`workflow-dashboard/`)

- **Changed:** Split monolithic `index.html` into `index.html` + `styles.css` + `app.js`
- **Removed:** Tailwind CSS CDN dependency — fully offline
- **Added:** CSS custom properties (design tokens)
- **Added:** Custom autopilot toggle component

### Documentation (`docs/`)

- **Added:** `architecture.md`, `getting-started.md`, `configuration.md`, `troubleshooting.md`, `changelog.md`

---

## v3.0.0 — Initial V3 Release

- 8-step workflow pipeline with quality gates
- Director / Planner / Executor / Workflow Master modes
- Persistent memory system (`PHASE_DNA.md`, `LESSONS_LEARNED.md`)
- History archiving with timestamps
- Git integration (auto-commit + tag on every transition)
- Web dashboard with real-time polling
- Autopilot toggle for full autonomy
- Plan injection (`-InjectPlan`)
- Interactive plan wizard (`-Plan`)
- Pre-flight environment checks
- Webhook notifications (Slack/Discord)
- Metrics recording (`METRICS.json`)
- File snapshots for rollback
- 5-strike escalation protocol (advisory)
- Roo Code extension fork with:
  - WorkflowEngine (TypeScript state machine)
  - WorkflowBridge (HTTP API on `:3001`)
  - StackDetector (universal tech-stack auto-detection)
  - ContextInjector (per-mode prompt injection)
  - GateValidator (VS Code command integration)
  - WorkflowWatcher (file observer for auto mode-switch)
  - WorkflowStatusBar (VS Code status bar widget)
