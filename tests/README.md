# Roo Workflow — Test Suite

Comprehensive integration tests covering the dashboard server, the bridge proxies, the PowerShell orchestrator, every quality gate, control flow (Reset/Undo/Resume), plan injection, and the 5-strike enforcement.

## Running

From the repository root:

```bash
# Full suite
npm test

# Or directly
node tests/api-suite.mjs

# Filter by suite name (substring match against the section header)
node tests/api-suite.mjs --filter "quality gates"
node tests/api-suite.mjs --filter "input validation"
```

## What it covers (50 tests, 9 suites)

| # | Suite | Coverage |
|---|---|---|
| 00 | Test environment bootstrap | Workspace creation, `init-workflow.ps1`, dashboard boot |
| 01 | Read endpoints | `/api/{status,dashboard,metrics,activity,progress,quality-gates,chat/history}` |
| 02 | Bridge proxies degrade gracefully | All `/api/{cycle,mode,autonomy}` proxies return 503 with helpful errors when bridge is offline |
| 03 | Input validation | `/api/inject-plan` rejects path traversal, absolute paths, non-`.md`, oversized bodies; chat empty body; autopilot wrong state |
| 04 | CORS + bind | Cross-origin POST → 403; localhost POST → 200; server bound to `127.0.0.1` |
| 05 | PowerShell orchestrator CLI | `-Status` / `-Next` from each state; cycleId assigned |
| 06 | Quality gates — negative tests | Each gate (1–5) rejects malformed input with the right message, accepts valid input |
| 07 | Control flow | `-Reset`, cycle-id rotation, `-Undo` |
| 08 | `-InjectPlan` | Bypass to EXECUTION |
| 09 | 5-strike enforcement | Force 5 NEEDS_REVISION → BLOCKED + `ESCALATION.md` |

## Architecture

- **Zero external dependencies** — uses Node's built-in `fetch`, `child_process`, `net`, `fs`. No Jest, no Mocha.
- **Isolated workspaces** — each run creates a temp dir under `%TEMP%/rooflow-test-*`, copies `orchestrator.ps1` + `init-workflow.ps1` + `workflow-dashboard/` into it, and runs there. The repository's own `WORKFLOW/` directory is never touched.
- **Free port allocation** — the dashboard binds to a port the OS picks; tests never collide with your running dashboard.
- **PowerShell tests** — spawn `powershell.exe -NonInteractive` with the right cwd; assert `code === 0` plus state-file deltas.

## Files

```
tests/
├── README.md                # this file
├── api-suite.mjs            # the test suite (50 tests across 9 suites)
└── lib/
    ├── runner.mjs           # zero-dep test runner: suite/test/assert/run + http() helper
    └── fixtures.mjs         # spawn helpers, isolated workspaces, free-port picker
```

## Adding a test

```js
// tests/api-suite.mjs
suite('10. My new suite', () => {
  test('describes a behavior', async () => {
    const r = await http(`${dashboard.base}/api/whatever`)
    assert.status(r, 200)
    assert.equal(r.body.foo, 'bar')
  })
})
```

`assert` provides: `ok`, `notOk`, `equal`, `deepEqual`, `match`, `contains`, `isType`, `status`, `greaterOrEqual`, `fail`.

## Continuous integration

The runner exits with code 0 on success, 1 on any failure — wire it into a GitHub Action like:

```yaml
- run: npm test
```

It takes ~30 seconds end-to-end (mostly PowerShell spawn overhead).
