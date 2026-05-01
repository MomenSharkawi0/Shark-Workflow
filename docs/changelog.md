# Changelog

All notable changes to Roo Workflow are documented here.

## v6.1.0 — Reliability fixes: autopilot stall, Gate 4, multi-phase, Director rigor (2026-05-01)

A focused reliability release driven by a real-world session that surfaced six interlocking failure modes in V6.0. Each fix is independently verified by the test suite (now **79/79 green**, +4 new tests in suite `12b`).

### Fix 1 — Autopilot no longer stalls at PLAN_REVIEW

V6.0's `WorkflowWatcher` swapped Roo modes silently after every state transition, but never re-prompted the agent. Mid-cycle role handoffs (most visibly at `PLAN_REVIEW`) ended the previous agent's turn without starting a new one — autopilot looked stuck even though the state machine was healthy.

- **New** `WORKFLOW/ACTIVE/CURRENT_INSTRUCTION.md` — orchestrator writes a fresh "what to do now" prompt on every transition. Wiped on every transition so stale instructions never linger.
- **Extended** `ContextInjector.DEFAULT_CONTEXT_FILES` — every mode (director/planner/executor/workflow-master) now auto-injects `CURRENT_INSTRUCTION.md` so the agent always sees the next action when it wakes up.
- **Extended** `roo-code-fork/src/workflow/index.ts` — after every mode swap, push a follow-up message via the same Roo task API the bridge already uses. 250ms debounce so the mode swap settles before the trigger fires.
- **New** `roo-code.resumeWorkflow` command + always-visible "▶ Resume Workflow" status-bar item. Fallback if the auto-trigger ever misses (e.g. the agent thread closed mid-session).

### Fix 2 — Quality Gate 4 honors testingMode and new-files-only work

V6.0 hard-required `## Files Modified` AND `## Tests Run`, blocking executors who only created new files or who were working on a project where the user had opted out of tests (an opt-out that didn't actually exist).

- **New** `testingMode: "tdd" | "post-hoc" | "none"` field in `WORKFLOW/workflow-config.json` (default `"post-hoc"`). Wizard option added.
- **New** `Get-WorkflowConfig` helper + `Test-ExecutionReportGate` shared by `EXECUTION` / `EXECUTION_BACKEND` / `EXECUTION_FRONTEND` gates.
- **Changed** Gate 4 regex now accepts `## Files Modified|Created|Changed` (alternation) for the file-list section.
- **Changed** When `testingMode=none`, the `_Skipped: testingMode=none_` marker satisfies the test-section requirement without the `## Tests Run` heading.
- **Mirror** in `roo-code-fork/src/workflow/GateValidator.ts` so the in-editor twin matches PS-side validation. Cross-reference comments tie the two regexes together to prevent drift.
- **Updated** `.roo/rules/executor-rules.md` — explicit guidance on the three accepted file-list headings and when the skip marker is appropriate.

### Fix 3 — Reconciler no longer rubber-stamps plans as APPROVED

V6.0's `PlanReconciler` hardcoded `STATUS: APPROVED`, and `WorkflowEngine` pre-wrote `PLAN_APPROVED.md` — the Director never actually reviewed reconciled plans. `-InjectPlan` jumped straight to `EXECUTION`, skipping `PLAN_REVIEW` entirely.

- **Changed** `PlanReconciler.reconcileToPlan` (TS + JS twin) — emits `STATUS: PENDING — Director must review...` instead of pre-approving. Gate 3 only accepts `APPROVED|NEEDS_REVISION`, so `-Next` blocks until a real review happens.
- **Changed** `WorkflowEngine.startCycle` — no longer pre-writes `PLAN_APPROVED.md` when ingesting a reconciled plan. That file belongs to the Director after a real `APPROVED`.
- **Changed** `orchestrator.ps1 -InjectPlan` — lands in `PLAN_REVIEW` instead of jumping to `EXECUTION`. The Director must actually approve before code runs.
- **Updated** legacy `-InjectPlan` fallback (when dashboard offline) — same `PENDING` posture; uses the source markdown verbatim instead of a "MODIFY ." dummy table.

### Fix 4 — Multi-phase queue: one cycle per phase

V6.0's reconciler collapsed every PRD into a single `## Phase 1: Implementation` regardless of how many phases the input described. A 13-module HR PRD or a 10-level Snake game ran as one giant cycle. Now they don't.

- **New** `extractPhases(md)` in `prdInterpreter.js` (and TS twin) — walks H2 headings matching `/^Phase\s+\d+/i` (top-level only). Returns `[]` for single-phase input so the existing fallback path is unchanged.
- **Extended** `PlanReconciler.reconcileToPlan` — when `phases.length > 1`, emits a `phaseQueue` payload `{cycles: [{number, title, body}], cursor: 0, projectName}`.
- **New** `WORKFLOW/PHASE_QUEUE.json` — written by `WorkflowEngine` and `orchestrator.ps1` when a multi-phase plan is ingested. Atomic write via the existing `Invoke-AtomicJsonWrite` helper.
- **Extended** orchestrator's `ARCHIVE → COMPLETE` handler — reads `PHASE_QUEUE.json`, advances the cursor, copies the next phase's content into a fresh `WORKFLOW/ACTIVE/PHASE_PLAN.md`, and re-routes the transition back to `PHASE_PLANNING` instead of terminal `COMPLETE`. Queue exhausted → cleanup + terminate normally. Parse failures degrade gracefully to terminal completion with a log warning.
- **New** `phaseIndex` and `phaseTotal` fields in `ORCHESTRATION_STATUS.json` (preserved across writes when not supplied by caller).
- **Surface** `phaseIndex / phaseTotal` in `/api/status` and the SSE `status_change` payload.
- **Dashboard** renders a "Phase 3 of 10" suffix on the state badge when running through a queue.
- **Documented** chat-continuity rule in `.roo/rules/workflow-master-rules.md`: stay in the same chat for the whole project so Workflow Master persists its role-shifting behavior across queued cycles.

### Fix 5 — Director rigor: real review context + explicit rejection criteria

V6.0's Director had no `DETAILED_PLAN.md` in its injected context, no rejection criteria in its rules, and a SELF_REVIEW_CHECKLIST that was advisory only. Plans got APPROVED with minimal scrutiny.

- **Extended** `ContextInjector` — Director and Workflow Master now receive `WORKFLOW/ACTIVE/PHASE_PLAN.md` and `WORKFLOW/ACTIVE/DETAILED_PLAN.md` in addition to lessons + DNA. They can actually review what they're stamping.
- **Extended** `.roo/rules/director-rules.md` — explicit "Reasons to mark NEEDS_REVISION" enumerated list (8 criteria for plan review, 5 for execution review). Specific guidance for `STATUS: PENDING` arriving via reconcile (read DETAILED_PLAN.md fully; do not just flip PENDING to APPROVED).
- **Extended** `WORKFLOW/SELF_REVIEW_CHECKLIST.md` plan-review section — replaced 3 vague items with 9 machine-checkable assertions (placeholder text detection, file existence, risk/rollback presence, test-strategy match against `testingMode`, PHASE_DNA contradiction check, scope-creep, PLAN_APPROVED.md copy step).

### Fix 6 — Dashboard polish: deliverable checks, current-mode badge, advance CTA

- **New** `readDeliverables()` in `server.js` — existence-checks `PHASE_PLAN.md / DETAILED_PLAN.md / PLAN_REVIEW.md / PLAN_APPROVED.md / EXECUTION_REPORT.md / EXECUTION_REVIEW.md / CURRENT_INSTRUCTION.md` in the existing 800ms loop. Surfaced in `/api/status` and SSE `status_change` events.
- **New** `WORKFLOW/CURRENT_MODE.json` sidecar — written by `WorkflowWatcher` on every Roo mode change. Kept separate from `ORCHESTRATION_STATUS.json` to avoid concurrent-write races with the orchestrator. 30-second mtime stale-window so a crashed extension doesn't poison the display.
- **Dashboard** renders an editor-mode badge ("Editor: PLANNER") next to the state, and a "▶ Click Next to advance" CTA when the current step's deliverable exists but the state hasn't transitioned.

### Tests

- **+4 new tests** in suite `12b. V6.1 reliability fixes`: tickle file written on every transition, Gate 4 alternation accepts `## Files Created`, Gate 4 accepts skip marker when `testingMode=none`, multi-phase reconciler emits `PHASE_QUEUE` for `N>1` phases.
- **Updated** suite 8 + 12 expectations: `-InjectPlan` now lands in `PLAN_REVIEW`; reconciler emits `STATUS: PENDING`; `PLAN_APPROVED.md` must NOT exist before Director reviews.
- **79/79 green**, ~33 sec full-run.

### Architectural notes

- The autopilot fix is split: tickle file (orchestrator-side) is the reliable baseline; Roo task API trigger (extension-side) is the fully-autonomous layer; status-bar Resume button is the always-on fallback. All three coexist — the status bar costs nothing if the trigger works.
- `phaseIndex / phaseTotal` are added to the status JSON without breaking schema. Old clients ignoring the new fields keep working.
- ASCII normalisation pass on `orchestrator.ps1` and `init-workflow.ps1` — Windows PowerShell 5.1 reads non-BOM `.ps1` files in ANSI by default and chokes on em-dashes (UTF-8 `0xE2 0x80 0x94` decoded as cp1252 produces stray bytes that broke parsing). All new content uses ASCII; pre-existing mojibake in heredoc strings was left intact since it doesn't affect parser balance.

---

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
