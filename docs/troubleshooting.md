# Roo Code Workflow — Troubleshooting

## Common Issues

### State Machine Stuck / Quality Gate Failure
**Symptom:** `orchestrator.ps1 -Next` throws a Quality Gate error.

**Fix:** The expected output file is missing or malformed.
1. Check which file is expected: `.\orchestrator.ps1 -Status`
2. Verify the file exists in `WORKFLOW/ACTIVE/`
3. Check it contains the required sections (e.g., `## Phase N`, `STATUS: APPROVED`)
4. If corrupt: `.\orchestrator.ps1 -Undo` to go back and retry

### Lock File Preventing Execution
**Symptom:** "Another orchestrator instance is running" error.

**Fix:** A previous run crashed without releasing the lock.
```powershell
Remove-Item WORKFLOW/.lock -Force
```

### Dashboard Shows "Disconnected"
**Symptom:** Red connection dot in the dashboard header.

**Fix:**
1. Verify the Express server is running: `cd workflow-dashboard && npm start`
2. Check port 3000 isn't blocked
3. Check browser console for CORS errors

### Autopilot Not Advancing
**Symptom:** Autopilot is ON but phases don't auto-advance.

**Fix:**
1. Ensure "Always approve terminal commands" is enabled in Roo Code settings
2. Check `ORCHESTRATION_STATUS.json` — `autopilot` should be `true`
3. Verify the Workflow Master mode is selected

### JSON Parse Errors
**Symptom:** Status file corruption causing parse errors.

**Fix:** The atomic write system should prevent this. If it still happens:
```powershell
.\orchestrator.ps1 -Reset
```

## Recovery Commands

| Scenario | Command |
|----------|---------|
| Go back one step | `.\orchestrator.ps1 -Undo` |
| Full reset (cleans ACTIVE/) | `.\orchestrator.ps1 -Reset` |
| Reset retry count | `.\orchestrator.ps1 -Resume` |
| Check current state | `.\orchestrator.ps1 -Status` |

## Logs

All orchestrator activity is logged to `WORKFLOW/orchestrator.log` with timestamps:
```
2026-04-26 12:00:00 [OK] Committed + tagged: workflow/20260426_120000/EXECUTION
2026-04-26 12:00:01 [INFO] Phase: Feature X
2026-04-26 12:00:02 [GATE] Quality Gate 4 passed
```

## Best Practices

- **Never edit `ORCHESTRATION_STATUS.json` manually** — let the orchestrator handle state
- **Keep `PHASE_DNA.md` pruned** — remove stale entries after their relevant phase passes
- **Trust the 5-Strike Rule** — if the Executor hits 5 strikes, fix manually, then update `LESSONS_LEARNED.md`
- **Use Technology Tags** — prefix lessons with `[LARAVEL]`, `[FLUTTER]`, `[GENERAL]` etc.
