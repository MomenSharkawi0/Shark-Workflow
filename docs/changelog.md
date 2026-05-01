# Changelog

All notable changes to Roo Workflow are documented here.

## v6.0.0 — PRD Ingestion + Per-phase Model Routing (2026-05-01)

The first V6 release. Two foundational additions; phases B / D / E (stack-recommendation engine, semantic gates, stack-aware prompts) ship in V6.1+.

### Phase A — PRD Ingestion + Plan Reconciliation

- **New** `roo-code-fork/src/workflow/PrdInterpreter.ts` (264 LOC) — pure heuristic markdown classifier + field extractor. No LLM call. Detects PRD-shaped vs plan-shaped vs hybrid markdown via heading signals. Extracts `projectName`, `summary`, `dataModel`, `constraints`, `successCriteria`, `stackHints` with per-field 0–1 confidence.
- **New** `roo-code-fork/src/workflow/PlanReconciler.ts` (130 LOC) — produces gate-compliant `{phasePlan, detailedPlan, planReview}` triplets from any markdown. Original input always preserved verbatim under `## Original Plan`. Replaces the legacy "Injected externally" dummy files.
- **New** dual JS mirror at `workflow-dashboard/lib/{prdInterpreter,planReconciler}.js` so the standalone Express server can run the same heuristics without a TypeScript toolchain.
- **New** `POST /api/ingest/prd` (dashboard) — body `{ markdown, mode: "interpret"|"reconcile" }`. Returns `{ kind, confidence, fields, signals }`, plus `reconciled` + `featureRequest` when mode=reconcile. 1 MB body cap.
- **New** `GET /api/ingest/sample` (dashboard) — returns the orphaned `HR_Platform_PRD.md` as demo payload. The orphan is now sample data.
- **New** `POST /api/ingest/interpret` (bridge) — graceful stub for V6.0; will gain LLM uplift in V6.1 when Roo Code exposes a synchronous one-shot completion API.
- **Extended** `WorkflowEngine.startCycle()` with `prefilledFeatureRequest` and `reconciledPlan` options. When provided, the engine writes the full PHASE_PLAN/DETAILED_PLAN/PLAN_REVIEW/PLAN_APPROVED triplet so gates 1–3 pass with real content rather than dummies.
- **Rewrote** `orchestrator.ps1 -InjectPlan` to call the dashboard's reconciler when reachable. Legacy dummy-file fallback retained for when the dashboard isn't running, with a warning to start it for proper reconciliation.
- **New** `prd-interpreter` mode registered in `init-workflow.ps1`'s generated `.roomodes` and in `ContextInjector`'s per-mode context map (just `wizard-options.json`).
- **New** dashboard "Import PRD or Plan" panel — paste markdown, drag-drop a file, or load the bundled HR sample. Confidence-coloured field chips (HIGH / MED / LOW). Two actions: "Apply to wizard" or "Use as plan, skip planning".
- **7 new tests** (Suite 12) covering classification, reconciliation, gate-regex compliance, and `-InjectPlan` regression.

### Phase C — Per-phase Model Routing

- **New** `roo-code-fork/src/workflow/ModelAdvisor.ts` (180 LOC) — preset routing matrix for budget / balanced / premium tiers. Maps intent labels (`small-fast`, `mid-balanced`, `large-smart`) to ranked candidate model ids per provider (Anthropic / OpenAI / Gemini / DeepSeek). Auto-bumps tier for very large projects.
- **Extended** `WorkflowConfig` with `perPhaseModels: boolean` (feature flag, default OFF) and `modelByMode: Record<mode, {modelId, provider?}>`.
- **New** `resolveModelOverride(activeMode)` exported from `roo-code-fork/src/workflow/index.ts`. Sibling of `resolveTokenBudget`. Returns null when feature flag is off or no override is configured — completely dormant by default.
- **Patched** `roo-code-fork/src/api/transform/model-params.ts` (sentinel-marked `// V6-WORKFLOW-PATCH`) to call `resolveModelOverride(activeMode)` and surface the chosen model id to `globalThis.__rooWorkflowModelOverride` so the dashboard status surface can show "EXEC · sonnet-4.5 · 32k". Localised one-line invocation; merge-conflict-friendly.
- **New** `GET/POST /api/config/models` (dashboard) — read + persist routing config to `WORKFLOW/workflow-config.json`. Atomic write, schema validation.
- **New** `GET /api/models/list` (bridge → dashboard proxy) — enumerates models the user has credentials for, falling back to the intent-candidate union when the provider's registry isn't accessible.
- **New** `GET /api/models/recommend` (bridge → dashboard proxy) — calls `ModelAdvisor.recommendRouting` with detected stack + estimated project size + budget tier.
- **New** dashboard "Model Routing" panel — collapsible, per-mode dropdowns, three tier presets (Budget / Balanced / Premium), one-click "AI recommend" button, "Enable per-phase routing" toggle.
- **6 new tests** (Suite 13) covering config round-trip, validation rejection, and bridge-offline graceful degradation.

### Test suite

- **75/75 green** (was 69; +6 for model routing). 30 sec full-run.

### Architectural notes

- The bridge's `/api/ingest/interpret` is a graceful stub for V6.0. The heuristic interpreter handles structured PRDs (like the HR fixture) on its own with high confidence. V6.1 will add LLM uplift via async polling once Roo Code exposes the right hook.
- Per-phase model routing uses `globalThis.__rooWorkflowMode` as the single coupling point with `model-params.ts`. Single sentinel-marked patch (`// V6-WORKFLOW-PATCH`) for clean upstream merges.
- Phases B (stack-recommendation engine), D (semantic LLM-as-Judge gates), and E (stack-aware phase prompts) are explicitly out of scope for V6.0 and tracked as V6.1+.

---

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
