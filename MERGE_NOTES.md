# Upstream Merge Notes

When syncing the embedded fork (`roo-code-fork/`) with upstream Roo Code, watch for conflicts in the files below. All workflow integration code lives in `roo-code-fork/src/workflow/` and is conflict-free by construction; only the touch-points listed here need attention.

## Sentinel-marked patches in upstream files

Search the fork for `V6-WORKFLOW-PATCH` to locate every line that needs human review during a merge:

```bash
grep -rn "V6-WORKFLOW-PATCH" roo-code-fork/src
```

### `src/api/transform/model-params.ts`

Two changes:

1. **Import line** at the top — adds `resolveModelOverride` alongside the existing `resolveTokenBudget`:
   ```ts
   // V6-WORKFLOW-PATCH: imports also pulls in resolveModelOverride for per-phase
   // model routing. Both functions are no-ops by default — they only kick in when
   // the user has WORKFLOW/workflow-config.json with `perPhaseModels: true` and a
   // `modelByMode` map.
   import { resolveTokenBudget, resolveModelOverride } from "../../workflow"
   ```

2. **In-function block** right after the existing `resolveTokenBudget` call — surfaces the configured per-mode model id to `globalThis.__rooWorkflowModelOverride`:
   ```ts
   if (activeMode) {
       const override = resolveModelOverride(activeMode)
       ;(globalThis as any).__rooWorkflowModelOverride = override?.modelId ?? null
   }
   ```

**On conflict:** keep both the upstream change AND the V6-WORKFLOW-PATCH block. The V6 logic is purely additive; it reads `globalThis.__rooWorkflowMode` (set elsewhere by `WorkflowWatcher`) and writes a sibling global. It does not modify `maxTokens`, `temperature`, or any other parameter beyond what was already happening.

### `src/extension.ts`

Single import + 9-line activation block (`activateWorkflowIntegration(context, provider as any)`). Documented in `roo-code-fork/MODIFICATIONS.md`. No sentinel comment in this file because the activation block is too obvious to miss — search for `activateWorkflowIntegration` if it does conflict.

## New directory (zero merge conflict risk)

`roo-code-fork/src/workflow/` is entirely workflow-owned. Upstream Roo Code never touches files here, so merges should be no-ops for these:

- `index.ts` — entry + config loader + `resolveTokenBudget` + V6 `resolveModelOverride`
- `WorkflowWatcher.ts` — auto mode-switch on `ORCHESTRATION_STATUS.json` change
- `WorkflowStatusBar.ts` — VS Code status bar widget
- `ContextInjector.ts` — per-mode prompt context injection
- `GateValidator.ts` — quality gate validation
- `WorkflowEngine.ts` — in-process AI orchestrator
- `WorkflowBridge.ts` — :3001 HTTP API for the dashboard
- `StackDetector.ts` — auto-detect tech stack from filesystem
- `DashboardPanel.ts` — VS Code webview wrapper
- **V6 Phase A:** `PrdInterpreter.ts`, `PlanReconciler.ts`
- **V6 Phase C:** `ModelAdvisor.ts`

## Standalone dashboard

`workflow-dashboard/` is also conflict-free with respect to upstream Roo Code. The dashboard runs as a separate Node process and only communicates via HTTP to the bridge on `:3001`.

## How to upgrade upstream

```bash
cd roo-code-fork
git remote add upstream https://github.com/RooCodeInc/Roo-Code.git   # one-time
git fetch upstream
git merge upstream/main

# Resolve any conflicts. With the structure above, conflicts should only
# appear in src/extension.ts (activation block) and src/api/transform/model-params.ts
# (V6-WORKFLOW-PATCH lines). Keep both sides.

# Verify the workflow code still compiles
pnpm install
pnpm vsix
node tests/api-suite.mjs   # from the repo root
```
