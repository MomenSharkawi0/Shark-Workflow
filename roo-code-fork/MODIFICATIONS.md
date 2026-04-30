# Modifications from upstream Roo Code

This directory is a derivative work of [RooCodeInc/Roo-Code](https://github.com/RooCodeInc/Roo-Code), licensed under Apache 2.0. The list below enumerates **every** modification introduced by Roo Workflow.

## New files (workflow integration)

All custom code is isolated in `src/workflow/` to minimise upstream merge conflicts:

| File | Purpose |
|---|---|
| `src/workflow/index.ts` | Entry point; exports `activateWorkflowIntegration()`. |
| `src/workflow/WorkflowWatcher.ts` | `fs.watch` on `WORKFLOW/ORCHESTRATION_STATUS.json`; auto-switches Roo Code mode (Director/Planner/Executor) on every transition. |
| `src/workflow/WorkflowStatusBar.ts` | Status bar widget showing current phase, retry count, autopilot status, and elapsed time. |
| `src/workflow/ContextInjector.ts` | Injects per-mode context files into the system prompt (e.g. Director gets DNA + lessons; Executor gets `PLAN_APPROVED.md`). |
| `src/workflow/GateValidator.ts` | Registers `roo-code.checkWorkflowGate` command; pops a webview on gate failure. |
| `src/workflow/WorkflowEngine.ts` | In-process AI orchestrator with three autonomy levels and LLM-as-Judge evaluation. |
| `src/workflow/WorkflowBridge.ts` | HTTP server on `:3001`. Endpoints: `/bridge/ping`, `/api/status`, `/api/events` (SSE), `/api/progress`, `/api/chat/history`, `/api/chat/send` (smart-routes new feature requests through `engine.startCycle`), `/api/cycle/start`, `/api/cycle/abort`, `/api/autonomy`, `/api/mode/switch`, `/api/mode/current`, plus orchestrator passthroughs. |
| `src/workflow/StackDetector.ts` | Auto-detects languages/frameworks/databases via file signatures. |
| `src/workflow/DashboardPanel.ts` | VS Code webview hosting the dashboard via iframe. |
| `MODIFICATIONS.md` | This file. |

## Modified files

### `src/extension.ts`

A single import and a 9-line try/catch block added inside `activate()`:

```ts
import { activateWorkflowIntegration } from "./workflow"   // ~line 50

// ...later in activate(), after registerCommands():
try {
    activateWorkflowIntegration(context, provider as any)
    outputChannel.appendLine("[Workflow] Workflow integration activated.")
} catch (error) {
    outputChannel.appendLine(
        `[Workflow] Failed to activate workflow integration: ${error instanceof Error ? error.message : String(error)}`,
    )
}
```

### `src/api/providers/deepseek.ts`

Two thinking-model variants added to the model detection map:

- `deepseek-v4-pro`
- `deepseek-v4-flash`

### `src/api/transform/model-params.ts`

~70 lines of parameter handling edits, primarily to surface `resolveTokenBudget()` for per-mode budgets (Director 4k, Planner 8k, Executor/Workflow Master 32k). See `src/workflow/index.ts:resolveTokenBudget`.

### `package.json`

- `"version"` bumped to `4.0.0` to distinguish from upstream releases.
- `clean` script changed from `rimraf` to `node scripts/clean-safe.mjs` to survive
  the Windows-specific `EPERM unlink .turbo/daemon/*.log` failure that occurs
  when the turbo daemon still holds its log file open. Same semantics — recursive
  delete with `force: true` — but with `maxRetries: 10` and EPERM/EBUSY tolerance.

### `scripts/clean-safe.mjs` (new)

Tiny Node wrapper that replaces `rimraf` in the workspace `clean` script.
Stops the turbo daemon first (so its log handle is closed), then deletes
with `fs.rmSync(maxRetries: 15)`. Tolerates EPERM/EBUSY/EACCES/ENOTEMPTY/
ENOENT (anything else is fatal).

### `scripts/install-vsix.js` (modified)

Added a `resolveEditorCommand()` helper that finds the VS Code (or Cursor /
Insiders) CLI even when it's not on PATH — searches the standard Windows
install locations (`%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd`,
Program Files, Cursor, Insiders) and macOS/Linux equivalents. When the CLI
genuinely cannot be found, prints a clear instruction block telling the
user how to install the VSIX manually via the GUI and how to add `code` to
PATH for next time. Original install behavior is preserved when the CLI is
on PATH.

## Building the VSIX

```powershell
cd roo-code-fork
pnpm install
pnpm install:vsix --editor=code
```

The `.vsix` lands in `bin/` and is auto-installed into VS Code.

## Syncing with upstream

Because all custom code is in `src/workflow/` and the only file-level edit is a single import + activation block in `src/extension.ts`, upstream sync rarely conflicts:

```powershell
git remote add upstream https://github.com/RooCodeInc/Roo-Code.git
git fetch upstream
git merge upstream/main
```

If `extension.ts` conflicts, keep both — the activation block is purely additive.
