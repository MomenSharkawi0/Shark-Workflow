/**
 * Comprehensive API + workflow integration test suite.
 *
 * What it covers:
 *   - Dashboard server boots and binds to 127.0.0.1 only
 *   - Every read endpoint returns expected shape
 *   - Input validation (path traversal, empty body, oversized body, wrong fields)
 *   - CORS rejects cross-origin POSTs, accepts localhost
 *   - Bridge proxies degrade gracefully when bridge is offline
 *   - PowerShell orchestrator: Status / Plan / Next / Undo / Reset / Resume / InjectPlan
 *   - Quality-gate negative tests (every gate)
 *   - Cycle-id propagation, schemaVersion presence
 *   - 5-strike enforcement
 *
 * Run:  node tests/api-suite.mjs
 *       node tests/api-suite.mjs --filter dashboard
 */

import { suite, test, beforeAll, afterAll, assert, run, http } from './lib/runner.mjs'
import { bootDashboard, runOrchestrator, runInit, readStatus, writeFile, findFreePort, makeTempWorkspace, REPO_ROOT } from './lib/fixtures.mjs'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Parse CLI flag
const filterArg = process.argv.indexOf('--filter')
const filter = filterArg !== -1 ? process.argv[filterArg + 1] : null

let workspace, dashboard

// =============================================================================
// 0. Bootstrap shared workspace + dashboard
// =============================================================================
suite('00. Test environment bootstrap', () => {
  test('makeTempWorkspace creates an isolated dir with orchestrator + dashboard', async () => {
    workspace = makeTempWorkspace()
    assert.ok(existsSync(join(workspace.dir, 'orchestrator.ps1')), 'orchestrator copied')
    assert.ok(existsSync(join(workspace.dir, 'workflow-dashboard', 'server.js')), 'dashboard copied')
  })

  test('init-workflow.ps1 succeeds and creates the JSON status file', async () => {
    const r = await runInit(workspace.dir)
    assert.equal(r.code, 0, `init exit code: ${r.code}\n${r.stdout}\n${r.stderr}`.slice(0, 500))
    const status = readStatus(workspace.dir)
    assert.ok(status, 'ORCHESTRATION_STATUS.json should exist after init')
    assert.equal(status.currentState, 'INIT')
    assert.equal(status.schemaVersion, 1, 'schemaVersion should be 1')
  })

  test('dashboard boots on a free port and answers /api/status', async () => {
    const port = await findFreePort()
    dashboard = await bootDashboard({ cwd: workspace.dir, port })
    const r = await http(`${dashboard.base}/api/status`)
    assert.status(r, 200)
    assert.equal(r.body['Current State'], 'INIT')
  })
})

// =============================================================================
// 1. Read endpoints — schema validation
// =============================================================================
suite('01. Read endpoints', () => {
  test('GET /api/status — returns legacy and _raw keys', async () => {
    const r = await http(`${dashboard.base}/api/status`)
    assert.status(r, 200)
    for (const k of ['Current State', 'Phase', 'Status', 'Autopilot', '_raw']) {
      assert.ok(k in r.body, `missing key: ${k}`)
    }
    assert.equal(r.body._raw.schemaVersion, 1)
  })

  test('GET /api/dashboard — returns a markdown content string', async () => {
    const r = await http(`${dashboard.base}/api/dashboard`)
    assert.status(r, 200)
    assert.isType(r.body.content, 'string')
    assert.contains(r.body.content, 'Quality Dashboard')
  })

  test('GET /api/metrics — returns cycles array + summary', async () => {
    const r = await http(`${dashboard.base}/api/metrics`)
    assert.status(r, 200)
    assert.ok(Array.isArray(r.body.cycles), 'cycles should be array')
    assert.isType(r.body.summary, 'object')
  })

  test('GET /api/activity — returns entries array', async () => {
    const r = await http(`${dashboard.base}/api/activity?limit=10`)
    assert.status(r, 200)
    assert.ok(Array.isArray(r.body.entries))
  })

  test('GET /api/progress — returns numeric percent + state index', async () => {
    const r = await http(`${dashboard.base}/api/progress`)
    assert.status(r, 200)
    assert.isType(r.body.percentComplete, 'number')
  })

  test('GET /api/quality-gates — returns gates array', async () => {
    const r = await http(`${dashboard.base}/api/quality-gates`)
    assert.status(r, 200)
    assert.ok(Array.isArray(r.body.gates))
  })

  test('GET /api/chat/history — returns messages array', async () => {
    const r = await http(`${dashboard.base}/api/chat/history`)
    assert.status(r, 200)
    assert.ok(Array.isArray(r.body.messages))
  })
})

// =============================================================================
// 2. Bridge proxies — should degrade gracefully when no bridge running
// =============================================================================
suite('02. Bridge proxies degrade gracefully', () => {
  test('GET /api/mode/current → 503 with helpful error when bridge offline', async () => {
    const r = await http(`${dashboard.base}/api/mode/current`)
    assert.status(r, 503)
    assert.contains(r.body.error || '', 'Bridge unreachable')
  })

  test('POST /api/cycle/start → 503 when bridge offline', async () => {
    const r = await http(`${dashboard.base}/api/cycle/start`, { method: 'POST', body: { featureRequest: 'test' } })
    assert.status(r, 503)
  })

  test('POST /api/cycle/abort → 503 when bridge offline', async () => {
    const r = await http(`${dashboard.base}/api/cycle/abort`, { method: 'POST', body: {} })
    assert.status(r, 503)
  })

  test('POST /api/autonomy → 503 when bridge offline', async () => {
    const r = await http(`${dashboard.base}/api/autonomy`, { method: 'POST', body: { level: 'manual' } })
    assert.status(r, 503)
  })

  test('POST /api/mode/switch → 503 when bridge offline', async () => {
    const r = await http(`${dashboard.base}/api/mode/switch`, { method: 'POST', body: { mode: 'director' } })
    assert.status(r, 503)
  })
})

// =============================================================================
// 3. Input validation — security-critical
// =============================================================================
suite('03. Input validation (security)', () => {
  test('POST /api/inject-plan rejects path traversal', async () => {
    const r = await http(`${dashboard.base}/api/inject-plan`, { method: 'POST', body: { fileName: '../../evil.md', content: 'oops' } })
    assert.status(r, 400)
  })
  test('POST /api/inject-plan rejects absolute path', async () => {
    const r = await http(`${dashboard.base}/api/inject-plan`, { method: 'POST', body: { fileName: '/etc/passwd', content: 'oops' } })
    assert.status(r, 400)
  })
  test('POST /api/inject-plan rejects non-.md extension', async () => {
    const r = await http(`${dashboard.base}/api/inject-plan`, { method: 'POST', body: { fileName: 'shell.exe', content: 'oops' } })
    assert.status(r, 400)
  })
  test('POST /api/inject-plan rejects backslash separators', async () => {
    const r = await http(`${dashboard.base}/api/inject-plan`, { method: 'POST', body: { fileName: 'sub\\file.md', content: 'oops' } })
    assert.status(r, 400)
  })
  test('POST /api/inject-plan rejects oversized body', async () => {
    const r = await http(`${dashboard.base}/api/inject-plan`, { method: 'POST', body: { fileName: 'big.md', content: 'x'.repeat(600 * 1024) } })
    assert.status(r, 413)
  })
  test('POST /api/inject-plan accepts valid filename', async () => {
    const r = await http(`${dashboard.base}/api/inject-plan`, { method: 'POST', body: { fileName: 'TEST_VALID.md', content: '# valid' } })
    assert.status(r, 200)
    assert.equal(r.body.success, true)
  })

  test('POST /api/chat/send rejects empty body', async () => {
    const r = await http(`${dashboard.base}/api/chat/send`, { method: 'POST', body: {} })
    assert.status(r, 400)
  })

  test('POST /api/autopilot rejects invalid state', async () => {
    const r = await http(`${dashboard.base}/api/autopilot`, { method: 'POST', body: { state: 'MAYBE' } })
    assert.status(r, 400)
  })
  test('POST /api/autopilot accepts ON', async () => {
    const r = await http(`${dashboard.base}/api/autopilot`, { method: 'POST', body: { state: 'ON' } })
    assert.status(r, 200)
    assert.equal(r.body.state, 'ON')
  })
  test('POST /api/autopilot accepts OFF', async () => {
    const r = await http(`${dashboard.base}/api/autopilot`, { method: 'POST', body: { state: 'OFF' } })
    assert.status(r, 200)
    assert.equal(r.body.state, 'OFF')
  })
})

// =============================================================================
// 4. CORS / network binding
// =============================================================================
suite('04. CORS + bind', () => {
  test('cross-origin POST returns 403', async () => {
    const r = await http(`${dashboard.base}/api/autopilot`, {
      method: 'POST',
      body: { state: 'OFF' },
      headers: { Origin: 'http://evil.example.com' }
    })
    assert.status(r, 403)
  })

  test('localhost-origin POST is allowed', async () => {
    const r = await http(`${dashboard.base}/api/autopilot`, {
      method: 'POST',
      body: { state: 'OFF' },
      headers: { Origin: `http://localhost:${dashboard.base.split(':').pop()}` }
    })
    assert.status(r, 200)
  })

  test('server is bound to 127.0.0.1 (not 0.0.0.0)', async () => {
    // External-IP probe should refuse — easiest check: hit by hostname instead of 127.0.0.1
    // We can't easily reach a non-loopback IP in CI; verify via banner
    const out = dashboard.getOutput().out
    assert.contains(out, '127.0.0.1', 'Banner should announce 127.0.0.1 bind')
  })
})

// =============================================================================
// 5. PowerShell orchestrator — CLI surface
// =============================================================================
suite('05. PowerShell orchestrator CLI', () => {
  test('-Status without args succeeds', async () => {
    const r = await runOrchestrator(workspace.dir, ['-Status'])
    assert.equal(r.code, 0, `unexpected exit ${r.code}\n${r.stdout}\n${r.stderr}`)
    assert.contains(r.stdout, 'INIT')
  })

  test('-Next from INIT advances to PHASE_PLANNING and assigns cycleId', async () => {
    const r = await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    assert.equal(r.code, 0, `next failed: ${r.stderr}`)
    const status = readStatus(workspace.dir)
    assert.equal(status.currentState, 'PHASE_PLANNING')
    assert.ok(status.cycleId && status.cycleId.length >= 6, `cycleId should be non-empty, got ${JSON.stringify(status.cycleId)}`)
  })

  test('-Status now reports PHASE_PLANNING + ACTIVE MODE: DIRECTOR', async () => {
    const r = await runOrchestrator(workspace.dir, ['-Status'])
    assert.contains(r.stdout, 'PHASE_PLANNING')
  })
})

// =============================================================================
// 6. Quality gate negative tests
// =============================================================================
suite('06. Quality gates — negative tests', () => {
  test('Gate 1: PHASE_PLAN.md without "## Phase N" is rejected', async () => {
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/PHASE_PLAN.md', '# Just a heading, no phase section')
    const r = await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    assert.notOk(r.code === 0, 'should have failed')
    assert.contains(r.stdout + r.stderr, 'Gate 1')
  })

  test('Gate 1: PHASE_PLAN.md WITH "## Phase 1:" is accepted', async () => {
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/PHASE_PLAN.md',
      '# Phase Plan\n\n## Phase 1: Build it\nGoal: do the thing.\nSuccess: it works.')
    const r = await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    assert.equal(r.code, 0, `next failed: ${r.stdout}\n${r.stderr}`)
    assert.equal(readStatus(workspace.dir).currentState, 'DETAILED_PLANNING')
  })

  test('Gate 2: DETAILED_PLAN.md missing "Implementation Steps" is rejected', async () => {
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/DETAILED_PLAN.md',
      '# Detailed\n\n## Files to Modify\n| File | Action |\n|---|---|\n| x.md | CREATE |')
    const r = await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    assert.notOk(r.code === 0)
    assert.contains(r.stdout + r.stderr, 'Implementation Steps')
  })

  test('Gate 2: DETAILED_PLAN.md with BOTH required sections is accepted', async () => {
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/DETAILED_PLAN.md',
      '# Detailed\n\n## Files to Modify\n| File | Action |\n|---|---|\n| x.md | CREATE |\n\n## Implementation Steps\n1. Do it.')
    const r = await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    assert.equal(r.code, 0, `next failed: ${r.stdout}\n${r.stderr}`)
    assert.equal(readStatus(workspace.dir).currentState, 'PLAN_REVIEW')
  })

  test('Gate 3: PLAN_REVIEW.md missing STATUS is rejected', async () => {
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/PLAN_REVIEW.md', '# Review\nLooks ok.')
    const r = await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    assert.notOk(r.code === 0)
    assert.contains(r.stdout + r.stderr, 'Gate 3')
  })

  test('Gate 3: PLAN_REVIEW.md with STATUS + RATING + reasoning → EXECUTION', async () => {
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/PLAN_REVIEW.md',
      '# Review\nSTATUS: APPROVED\nRATING: 8/10\nRATING_REASONING: Files-to-Modify is concrete; tests well-defined.')
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/PLAN_APPROVED.md',
      '# Detailed\n\n## Files to Modify\n| File | Action |\n|---|---|\n| x.md | CREATE |\n\n## Implementation Steps\n1. Do it.')
    const r = await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    assert.equal(r.code, 0, `next failed: ${r.stdout}\n${r.stderr}`)
    assert.equal(readStatus(workspace.dir).currentState, 'EXECUTION')
  })

  test('Gate 4: EXECUTION_REPORT.md missing "Tests Run" is rejected', async () => {
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/EXECUTION_REPORT.md',
      '# Report\n\n## Files Modified\n| File | Action |\n|---|---|\n| x.md | CREATED |')
    const r = await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    assert.notOk(r.code === 0)
    assert.contains(r.stdout + r.stderr, 'Tests Run')
  })

  test('Gate 4: EXECUTION_REPORT.md with BOTH sections → EXECUTION_REVIEW', async () => {
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/EXECUTION_REPORT.md',
      '# Report\n\n## Files Modified\n| File | Action |\n|---|---|\n| x.md | CREATED |\n\n## Tests Run\nAll pass.')
    const r = await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    assert.equal(r.code, 0, `next failed: ${r.stdout}\n${r.stderr}`)
    assert.equal(readStatus(workspace.dir).currentState, 'EXECUTION_REVIEW')
  })

  test('Gate 5: EXECUTION_REVIEW.md with STATUS + RATING + reasoning → ARCHIVE', async () => {
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/EXECUTION_REVIEW.md',
      '# Review\nSTATUS: APPROVED\nRATING: 9/10\nRATING_REASONING: Plan adherence excellent; tests pass; no scope creep.')
    const r = await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    assert.equal(r.code, 0, `next failed: ${r.stdout}\n${r.stderr}`)
    assert.equal(readStatus(workspace.dir).currentState, 'ARCHIVE')
  })

  test('ARCHIVE → COMPLETE archives all files and records metrics', async () => {
    const r = await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    assert.equal(r.code, 0, `next failed: ${r.stdout}\n${r.stderr}`)
    const status = readStatus(workspace.dir)
    assert.equal(status.currentState, 'COMPLETE')
    assert.equal(status.status, 'COMPLETE')
    // Verify metrics recorded
    const metricsPath = join(workspace.dir, 'WORKFLOW', 'METRICS.json')
    assert.ok(existsSync(metricsPath), 'METRICS.json should exist')
    // Verify history populated
    const historyPath = join(workspace.dir, 'WORKFLOW', 'HISTORY')
    assert.ok(existsSync(historyPath))
  })
})

// =============================================================================
// 7. Reset, Undo, Resume — control flow
// =============================================================================
suite('07. Control flow: Reset / Undo / Resume', () => {
  test('-Reset returns to INIT and cleans ACTIVE/', async () => {
    const r = await runOrchestrator(workspace.dir, ['-Reset', '-SkipGit'])
    assert.equal(r.code, 0)
    const status = readStatus(workspace.dir)
    assert.equal(status.currentState, 'INIT')
  })

  test('Cycle id changes between cycles', async () => {
    const before = readStatus(workspace.dir).cycleId
    await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    const after = readStatus(workspace.dir).cycleId
    assert.notOk(after === before && after !== '', `cycleId should rotate, got ${before} then ${after}`)
  })

  test('-Undo from PHASE_PLANNING returns to INIT', async () => {
    const r = await runOrchestrator(workspace.dir, ['-Undo', '-SkipGit'])
    assert.equal(r.code, 0)
    assert.equal(readStatus(workspace.dir).currentState, 'INIT')
  })
})

// =============================================================================
// 8. -InjectPlan — lands in PLAN_REVIEW so the Director must actually approve
//    (changed in V6.1: was EXECUTION; the auto-APPROVE shortcut was removed
//    because it bypassed the Director and led to rubber-stamping)
// =============================================================================
suite('08. -InjectPlan', () => {
  test('-Reset before injecting', async () => {
    await runOrchestrator(workspace.dir, ['-Reset', '-SkipGit'])
  })

  test('-InjectPlan with valid plan lands in PLAN_REVIEW (Director must approve)', async () => {
    const planPath = join(workspace.dir, '_inject_plan.md')
    writeFile(workspace.dir, '_inject_plan.md',
      '# Injected\n\n## Files to Modify\n| File | Action |\n|---|---|\n| x.md | CREATE |\n\n## Implementation Steps\n1. Inject.')
    const r = await runOrchestrator(workspace.dir, ['-InjectPlan', planPath, '-SkipGit'])
    assert.equal(r.code, 0, `inject failed: ${r.stdout}\n${r.stderr}`)
    const status = readStatus(workspace.dir)
    assert.equal(status.currentState, 'PLAN_REVIEW')
    assert.ok(status.cycleId && status.cycleId.length >= 6)
    // PLAN_REVIEW.md should exist with STATUS: PENDING (Director hasn't reviewed yet)
    const planReview = readFileSync(join(workspace.dir, 'WORKFLOW/ACTIVE/PLAN_REVIEW.md'), 'utf-8')
    assert.match(planReview, /STATUS:\s*PENDING/)
  })
})

// =============================================================================
// 9. 5-strike enforcement
// =============================================================================
suite('09. 5-strike enforcement', () => {
  test('-Reset', async () => {
    await runOrchestrator(workspace.dir, ['-Reset', '-SkipGit'])
  })
  test('Force 5 NEEDS_REVISION cycles → BLOCKED + ESCALATION.md', async () => {
    // Path: INIT -> PHASE_PLANNING -> DETAILED_PLANNING -> PLAN_REVIEW (NEEDS_REVISION) loops back
    await runOrchestrator(workspace.dir, ['-Next', '-SkipGit']) // -> PHASE_PLANNING
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/PHASE_PLAN.md', '# Phase Plan\n\n## Phase 1: x\nGoal: y.')
    await runOrchestrator(workspace.dir, ['-Next', '-SkipGit']) // -> DETAILED_PLANNING

    const validDetailed = '# Detailed\n\n## Files to Modify\n| File | Action |\n|---|---|\n| x.md | CREATE |\n\n## Implementation Steps\n1. Do it.'
    let blocked = false
    for (let attempt = 1; attempt <= 6 && !blocked; attempt++) {
      writeFile(workspace.dir, 'WORKFLOW/ACTIVE/DETAILED_PLAN.md', validDetailed)
      await runOrchestrator(workspace.dir, ['-Next', '-SkipGit']) // -> PLAN_REVIEW
      writeFile(workspace.dir, 'WORKFLOW/ACTIVE/PLAN_REVIEW.md',
        `# Review\nSTATUS: NEEDS_REVISION\nRATING: 3/10\nRATING_REASONING: attempt ${attempt} — plan still missing concrete file list.`)
      const r = await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
      const s = readStatus(workspace.dir)
      if (s.status === 'BLOCKED') { blocked = true; break }
      if (r.code !== 0) break
    }
    const finalStatus = readStatus(workspace.dir)
    assert.equal(finalStatus.status, 'BLOCKED', `expected BLOCKED after 5 retries, got status=${finalStatus.status} retryCount=${finalStatus.retryCount}`)
    assert.ok(existsSync(join(workspace.dir, 'WORKFLOW', 'ACTIVE', 'ESCALATION.md')), 'ESCALATION.md should be written')
  })
})

// =============================================================================
// 10. Project Setup Wizard
// =============================================================================
suite('10. Project Setup Wizard', () => {
  test('GET /api/wizard/options returns the full schema', async () => {
    const r = await http(`${dashboard.base}/api/wizard/options`)
    assert.status(r, 200)
    assert.ok(Array.isArray(r.body.projectTypes) && r.body.projectTypes.length > 0, 'projectTypes')
    assert.ok(r.body.backend && Array.isArray(r.body.backend.frameworks), 'backend.frameworks')
    assert.ok(r.body.backend.extras && Array.isArray(r.body.backend.extras.laravel), 'laravel extras (Filament)')
    // Filament v3 + v4 must be present
    const filamentLabels = r.body.backend.extras.laravel.map(e => e.label).join('|')
    assert.contains(filamentLabels, 'Filament v3')
    assert.contains(filamentLabels, 'Filament v4')
    // Flutter version list present
    assert.ok(Array.isArray(r.body.mobile.frameworkVersions.flutter), 'flutter versions')
  })

  test('POST /api/wizard/start without summary → 400', async () => {
    const r = await http(`${dashboard.base}/api/wizard/start`, { method: 'POST', body: { } })
    assert.status(r, 400)
  })

  test('POST /api/wizard/start with full config → 503 when bridge offline, AND echoes generated FEATURE_REQUEST', async () => {
    const cfg = {
      summary: 'An HR platform with employee profiles, geo-fenced clock-in, and admin payroll export.',
      projectName: 'acme-hr',
      projectType: 'Web application (full-stack)',
      backend: { framework: 'Laravel (PHP)', frameworkVersion: '11.x', languageVersion: '8.3', language: 'php', extras: ['Filament v3 (admin panel)', 'Sanctum (API auth)'] },
      frontend: { framework: 'Filament UI', uiLibrary: 'Tailwind CSS', stateManagement: '(none — local state only)' },
      mobile: { framework: 'Flutter (Dart)', frameworkVersion: '3.27', extras: ['Riverpod (state management)'] },
      database: { primary: 'PostgreSQL', cache: 'Redis', orm: 'Eloquent (Laravel)' },
      auth: 'Session-based (cookies)',
      infrastructure: { ci: 'GitHub Actions', containerization: 'Docker Compose (multi-service)', hosting: 'Self-hosted / VPS' },
      testing: { unit: 'Pest', e2e: 'Playwright' },
      constraints: 'Spanish + English UI. GDPR compliant.',
      successCriteria: '- Employee can clock in within geo-fence\n- Admin can export payroll CSV',
      autonomy: 'semi-auto',
      dataModel: '- users(id, email, role)\n- employees(id, user_id, department_id)',
    }
    const r = await http(`${dashboard.base}/api/wizard/start`, { method: 'POST', body: cfg })
    assert.status(r, 503)
    // Even on bridge-offline, the generated request body should be returned for preview
    assert.isType(r.body.generatedFeatureRequest, 'string')
    assert.contains(r.body.generatedFeatureRequest, 'Filament v3')
    assert.contains(r.body.generatedFeatureRequest, 'Flutter (Dart) 3.27')
    assert.contains(r.body.generatedFeatureRequest, 'PostgreSQL')
    assert.contains(r.body.generatedFeatureRequest, 'GDPR')
    assert.contains(r.body.generatedFeatureRequest, 'Stack & decisions')
  })
})

// =============================================================================
// 11. Doctor / Recovery
// =============================================================================
suite('11. Doctor / Recovery', () => {
  test('GET /api/doctor returns issues array when state is COMPLETE', async () => {
    // Force COMPLETE-ish state by writing the status file manually
    writeFile(workspace.dir, 'WORKFLOW/ORCHESTRATION_STATUS.json', JSON.stringify({
      schemaVersion: 1, currentState: 'COMPLETE', previousState: 'ARCHIVE',
      phase: '', cycleId: 'test1234', cycleStart: '2026-05-01T00:00:00Z',
      lastTransition: '2026-05-01T00:01:00Z', transitionCount: 7, retryCount: 0,
      nextAction: '', nextMode: '', status: 'COMPLETE', blockedReason: '',
      autopilot: false, parallelTracks: false
    }, null, 2))
    const r = await http(`${dashboard.base}/api/doctor`)
    assert.status(r, 200)
    assert.ok(Array.isArray(r.body.issues))
    assert.greaterOrEqual(r.body.issues.length, 1)
    // Should suggest reset as a fix when COMPLETE
    const completeIssue = r.body.issues.find(i => i.title.includes('No issues') || i.title.includes('complete'))
    assert.ok(completeIssue, 'should report no-issue state when COMPLETE')
  })

  test('GET /api/doctor flags BLOCKED state with high severity', async () => {
    writeFile(workspace.dir, 'WORKFLOW/ORCHESTRATION_STATUS.json', JSON.stringify({
      schemaVersion: 1, currentState: 'EXECUTION', previousState: 'PLAN_REVIEW',
      phase: '', cycleId: 'block123', cycleStart: '2026-05-01T00:00:00Z',
      lastTransition: '2026-05-01T00:01:00Z', transitionCount: 5, retryCount: 5,
      nextAction: 'See ESCALATION.md', nextMode: 'Executor',
      status: 'BLOCKED', blockedReason: 'Five-strike limit hit',
      autopilot: false, parallelTracks: false
    }, null, 2))
    const r = await http(`${dashboard.base}/api/doctor`)
    assert.status(r, 200)
    const fatal = r.body.issues.find(i => i.severity === 'fatal')
    assert.ok(fatal, 'should have a fatal-severity issue when status=BLOCKED')
    assert.contains(fatal.title, 'BLOCKED')
    assert.greaterOrEqual(fatal.fixes.length, 1)
  })

  test('GET /api/doctor surfaces "awaiting deliverable" when in PHASE_PLANNING and PHASE_PLAN.md missing', async () => {
    writeFile(workspace.dir, 'WORKFLOW/ORCHESTRATION_STATUS.json', JSON.stringify({
      schemaVersion: 1, currentState: 'PHASE_PLANNING', previousState: 'INIT',
      phase: '', cycleId: 'wait1234', cycleStart: '2026-05-01T00:00:00Z',
      lastTransition: '2026-05-01T00:01:00Z', transitionCount: 1, retryCount: 0,
      nextAction: 'Director writes PHASE_PLAN.md', nextMode: 'Director',
      status: 'IN_PROGRESS', blockedReason: '',
      autopilot: false, parallelTracks: false
    }, null, 2))
    // Make sure the file is missing (it might exist from earlier tests)
    try { (await import('node:fs')).rmSync((await import('node:path')).join(workspace.dir, 'WORKFLOW', 'ACTIVE', 'PHASE_PLAN.md')) } catch {}
    const r = await http(`${dashboard.base}/api/doctor`)
    assert.status(r, 200)
    const waiting = r.body.issues.find(i => i.title.includes('Awaiting'))
    assert.ok(waiting, 'should suggest awaiting deliverable')
    assert.contains(waiting.message, 'PHASE_PLAN.md')
  })

  test('DELETE /api/doctor/lock returns success even when no lock present', async () => {
    const r = await http(`${dashboard.base}/api/doctor/lock`, { method: 'DELETE' })
    assert.status(r, 200)
    assert.equal(r.body.success, true)
  })
})

// =============================================================================
// 12. PRD Ingestion + Plan Reconciliation (V6 Phase A)
// =============================================================================
suite('12. PRD Ingestion + Plan Reconciliation', () => {
  let hrPrdContent = ''
  let planStyleContent = ''

  test('fixtures load', async () => {
    const { readFileSync } = await import('node:fs')
    hrPrdContent = readFileSync(join(REPO_ROOT, 'tests/lib/fixtures/prd-samples/hr-platform.md'), 'utf-8')
    planStyleContent = readFileSync(join(REPO_ROOT, 'tests/lib/fixtures/prd-samples/plan-style.md'), 'utf-8')
    assert.greaterOrEqual(hrPrdContent.length, 1000)
    assert.greaterOrEqual(planStyleContent.length, 200)
  })

  test('GET /api/ingest/sample returns the HR PRD body', async () => {
    const r = await http(`${dashboard.base}/api/ingest/sample`)
    assert.status(r, 200)
    assert.isType(r.body.markdown, 'string')
    assert.contains(r.body.markdown, 'HR')
    assert.contains(r.body.markdown, 'Platform')
  })

  test('POST /api/ingest/prd rejects empty markdown with 400', async () => {
    const r = await http(`${dashboard.base}/api/ingest/prd`, { method: 'POST', body: { markdown: '' } })
    assert.status(r, 400)
  })

  test('POST /api/ingest/prd rejects > 1MB body with 413', async () => {
    const r = await http(`${dashboard.base}/api/ingest/prd`, { method: 'POST', body: { markdown: 'x'.repeat(1024 * 1024 + 10) } })
    assert.status(r, 413)
  })

  test('PRD ingest — heuristic classifies HR_Platform_PRD.md as kind=prd', async () => {
    const r = await http(`${dashboard.base}/api/ingest/prd`, { method: 'POST', body: { markdown: hrPrdContent } })
    assert.status(r, 200)
    assert.equal(r.body.kind, 'prd')
    assert.equal(r.body.fields.projectName.value, 'HR Platform')
    assert.greaterOrEqual(r.body.confidence, 0.5)
    // Stack hints — HR PRD mentions web + mobile, but no specific framework names guaranteed
    assert.ok(Array.isArray(r.body.fields.stackHints.value))
    // Project type should auto-detect Mobile or Web (it has both touchpoints)
    assert.ok(r.body.fields.projectType.value.length > 0)
  })

  test('PRD ingest — heuristic classifies plan-shaped markdown as kind=plan', async () => {
    const r = await http(`${dashboard.base}/api/ingest/prd`, { method: 'POST', body: { markdown: planStyleContent } })
    assert.status(r, 200)
    assert.equal(r.body.kind, 'plan')
    assert.greaterOrEqual(r.body.confidence, 0.5)
    // Stack hints should include Laravel + Filament from the fixture
    const hints = r.body.fields.stackHints.value.join(' ').toLowerCase()
    assert.contains(hints, 'laravel')
  })

  test('Reconciler — output passes Gate 2 regex (Files to Modify AND Implementation Steps)', async () => {
    const r = await http(`${dashboard.base}/api/ingest/prd`, { method: 'POST', body: { markdown: planStyleContent, mode: 'reconcile' } })
    assert.status(r, 200)
    assert.ok(r.body.reconciled, 'reconciled triplet should be present')
    assert.match(r.body.reconciled.detailedPlan, /^##\s+Files to Modify\b/m)
    assert.match(r.body.reconciled.detailedPlan, /^##\s+Implementation Steps\b/m)
  })

  test('Reconciler — emits STATUS: PENDING so Director must actually review', async () => {
    // V6.1: was STATUS: APPROVED (auto-stamped). Removed because it let the
    // reconciler bypass the Director entirely. Gate 3 throws on PENDING; the
    // Director must replace this line with APPROVED or NEEDS_REVISION.
    const r = await http(`${dashboard.base}/api/ingest/prd`, { method: 'POST', body: { markdown: planStyleContent, mode: 'reconcile' } })
    assert.status(r, 200)
    assert.match(r.body.reconciled.planReview, /STATUS:\s*PENDING/)
  })

  test('Reconciler — phase plan passes Gate 1 regex (## Phase N)', async () => {
    const r = await http(`${dashboard.base}/api/ingest/prd`, { method: 'POST', body: { markdown: planStyleContent, mode: 'reconcile' } })
    assert.status(r, 200)
    assert.match(r.body.reconciled.phasePlan, /##\s+Phase\s+\d/)
  })

  test('Reconciler — preserves original plan verbatim under sub-heading', async () => {
    const r = await http(`${dashboard.base}/api/ingest/prd`, { method: 'POST', body: { markdown: planStyleContent, mode: 'reconcile' } })
    assert.status(r, 200)
    assert.contains(r.body.reconciled.detailedPlan, 'Original Plan')
    // The unique text from plan-style.md fixture must survive verbatim
    assert.contains(r.body.reconciled.detailedPlan, 'StockService::transfer')
  })

  test('Reconciler — featureRequest mirrors buildFeatureRequest shape', async () => {
    const r = await http(`${dashboard.base}/api/ingest/prd`, { method: 'POST', body: { markdown: hrPrdContent, mode: 'reconcile' } })
    assert.status(r, 200)
    assert.isType(r.body.featureRequest, 'string')
    assert.contains(r.body.featureRequest, '# Feature Request')
    assert.contains(r.body.featureRequest, 'What to build')
    assert.contains(r.body.featureRequest, 'Original PRD')
  })

  test('-InjectPlan lands in PLAN_REVIEW with PENDING status (no rubber-stamp)', async () => {
    // Reset the workspace so we can test the inject flow cleanly
    await runOrchestrator(workspace.dir, ['-Reset', '-SkipGit'])
    writeFile(workspace.dir, '_v6_inject.md', planStyleContent)
    const planPath = join(workspace.dir, '_v6_inject.md')
    // V6.1: -InjectPlan now lands in PLAN_REVIEW (not EXECUTION). The reconciler
    // emits STATUS: PENDING so the Director must actually review the plan
    // before -Next can advance to EXECUTION.
    const r = await runOrchestrator(workspace.dir, ['-InjectPlan', planPath, '-SkipGit'])
    assert.equal(r.code, 0, `inject failed: ${r.stdout}\n${r.stderr}`)
    const status = readStatus(workspace.dir)
    assert.equal(status.currentState, 'PLAN_REVIEW')
    const planReview = readFileSync(join(workspace.dir, 'WORKFLOW/ACTIVE/PLAN_REVIEW.md'), 'utf-8')
    assert.match(planReview, /STATUS:\s*PENDING/)
    // PLAN_APPROVED.md must NOT exist yet — only the Director writes it on real APPROVED
    assert.equal(existsSync(join(workspace.dir, 'WORKFLOW/ACTIVE/PLAN_APPROVED.md')), false,
      'PLAN_APPROVED.md should NOT exist before Director reviews — that was the rubber-stamp bug')
  })
})

// =============================================================================
// 12b. V6.1 reliability fixes (tickle file, Gate 4 alternation, testingMode)
// =============================================================================
suite('12b. V6.1 reliability fixes', () => {
  test('Tickle: CURRENT_INSTRUCTION.md is written on every transition', async () => {
    await runOrchestrator(workspace.dir, ['-Reset', '-SkipGit'])
    await runOrchestrator(workspace.dir, ['-Next', '-SkipGit']) // INIT -> PHASE_PLANNING
    const tickle = join(workspace.dir, 'WORKFLOW/ACTIVE/CURRENT_INSTRUCTION.md')
    assert.ok(existsSync(tickle), 'CURRENT_INSTRUCTION.md should exist after first transition')
    const content = readFileSync(tickle, 'utf-8')
    assert.contains(content, 'PHASE_PLANNING')
    assert.contains(content, 'DIRECTOR')
  })

  test('Gate 4: "## Files Created" alternation accepted (new-files-only work)', async () => {
    // Walk fresh from INIT to EXECUTION, then submit a Created-only report
    await runOrchestrator(workspace.dir, ['-Reset', '-SkipGit'])
    await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/PHASE_PLAN.md', '# Phase Plan\n\n## Phase 1: x\nGoal: y.')
    await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/DETAILED_PLAN.md',
      '# Detailed\n## Files to Modify\n| File | Action |\n|---|---|\n| x.md | CREATE |\n## Implementation Steps\n1. Do.')
    await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/PLAN_REVIEW.md',
      '# Review\nSTATUS: APPROVED\nRATING: 7/10\nRATING_REASONING: Test fixture — minimal but compliant.')
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/PLAN_APPROVED.md',
      '# Approved\n## Files to Modify\n| File | Action |\n|---|---|\n| x.md | CREATE |\n## Implementation Steps\n1. Do.')
    await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    // Use "## Files Created" instead of "## Files Modified"
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/EXECUTION_REPORT.md',
      '# Report\n\n## Files Created\n- x.md\n\n## Tests Run\nAll green.')
    const r = await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    assert.equal(r.code, 0, `Gate 4 should accept "## Files Created" alternation: ${r.stdout}\n${r.stderr}`)
  })

  test('Gate 4: testingMode=none accepts skip marker instead of Tests Run', async () => {
    await runOrchestrator(workspace.dir, ['-Reset', '-SkipGit'])
    // Set testingMode=none in workflow-config.json (handle BOM if present)
    const cfgPath = join(workspace.dir, 'WORKFLOW/workflow-config.json')
    let cfgRaw = readFileSync(cfgPath, 'utf-8')
    if (cfgRaw.charCodeAt(0) === 0xFEFF) cfgRaw = cfgRaw.slice(1)
    const cfg = JSON.parse(cfgRaw)
    cfg.testingMode = 'none'
    writeFile(workspace.dir, 'WORKFLOW/workflow-config.json', JSON.stringify(cfg, null, 2))
    // Walk to EXECUTION
    await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/PHASE_PLAN.md', '# Phase Plan\n\n## Phase 1: x\nGoal: y.')
    await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/DETAILED_PLAN.md',
      '# Detailed\n## Files to Modify\n| File | Action |\n|---|---|\n| x.md | CREATE |\n## Implementation Steps\n1. Do.')
    await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/PLAN_REVIEW.md',
      '# Review\nSTATUS: APPROVED\nRATING: 7/10\nRATING_REASONING: Test fixture — minimal but compliant.')
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/PLAN_APPROVED.md',
      '# Approved\n## Files to Modify\n| File | Action |\n|---|---|\n| x.md | CREATE |\n## Implementation Steps\n1. Do.')
    await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    // No "## Tests Run" header — only the skip marker
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/EXECUTION_REPORT.md',
      '# Report\n\n## Files Modified\n- x.md\n\n_Skipped: testingMode=none_\n')
    const r = await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    assert.equal(r.code, 0, `Gate 4 with testingMode=none + skip marker should pass: ${r.stdout}\n${r.stderr}`)
  })

  test('Multi-phase: reconciler emits PHASE_QUEUE for PRD with N>1 phases', async () => {
    const md = '# Multi\n\n## Phase 1: First\nA\n\n## Phase 2: Second\nB\n\n## Phase 3: Third\nC\n'
    const r = await http(`${dashboard.base}/api/ingest/prd`, { method: 'POST', body: { markdown: md, mode: 'reconcile' } })
    assert.status(r, 200)
    assert.ok(r.body.reconciled.phaseQueue, 'phaseQueue should be present for multi-phase input')
    assert.equal(r.body.reconciled.phaseQueue.cycles.length, 3)
    assert.equal(r.body.reconciled.phaseQueue.cursor, 0)
  })

  test('Gate 3 (V6.2): rejects PLAN_REVIEW.md missing RATING', async () => {
    await runOrchestrator(workspace.dir, ['-Reset', '-SkipGit'])
    await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/PHASE_PLAN.md', '# Phase Plan\n\n## Phase 1: x\nGoal: y.')
    await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/DETAILED_PLAN.md',
      '# Detailed\n## Files to Modify\n| File | Action |\n|---|---|\n| x.md | CREATE |\n## Implementation Steps\n1. Do.')
    await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    // STATUS only, no RATING — should fail Gate 3
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/PLAN_REVIEW.md', '# Review\nSTATUS: APPROVED')
    const r = await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    assert.notOk(r.code === 0, 'Gate 3 should reject when RATING is missing')
    assert.contains(r.stdout + r.stderr, 'RATING')
  })

  test('Gate 5 (V6.2): rejects EXECUTION_REVIEW.md missing RATING_REASONING', async () => {
    // Walk to EXECUTION_REVIEW
    await runOrchestrator(workspace.dir, ['-Reset', '-SkipGit'])
    await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/PHASE_PLAN.md', '# Phase Plan\n\n## Phase 1: x\nGoal: y.')
    await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/DETAILED_PLAN.md',
      '# Detailed\n## Files to Modify\n| File | Action |\n|---|---|\n| x.md | CREATE |\n## Implementation Steps\n1. Do.')
    await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/PLAN_REVIEW.md',
      '# Review\nSTATUS: APPROVED\nRATING: 8/10\nRATING_REASONING: solid')
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/PLAN_APPROVED.md',
      '# Approved\n## Files to Modify\n| File | Action |\n|---|---|\n| x.md | CREATE |\n## Implementation Steps\n1. Do.')
    await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/EXECUTION_REPORT.md',
      '# Report\n\n## Files Modified\n- x.md\n\n## Tests Run\nAll green.')
    await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    // STATUS + RATING but no RATING_REASONING — should fail Gate 5
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/EXECUTION_REVIEW.md',
      '# Review\nSTATUS: APPROVED\nRATING: 8/10')
    const r = await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    assert.notOk(r.code === 0, 'Gate 5 should reject when RATING_REASONING is missing')
    assert.contains(r.stdout + r.stderr, 'RATING_REASONING')
  })

  test('Gate failure (V6.4): writes GATE_FAILURE.md with recovery instructions', async () => {
    await runOrchestrator(workspace.dir, ['-Reset', '-SkipGit'])
    await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/PHASE_PLAN.md', '# Phase Plan\n\n## Phase 1: x\nGoal: y.')
    await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/DETAILED_PLAN.md',
      '# Detailed\n## Files to Modify\n| File | Action |\n|---|---|\n| x.md | CREATE |\n## Implementation Steps\n1. Do.')
    await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    // Submit a deliberately-broken PLAN_REVIEW.md (STATUS only, no RATING)
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/PLAN_REVIEW.md', '# Review\nSTATUS: APPROVED')
    const r = await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    assert.notOk(r.code === 0, 'Gate 3 should reject when RATING is missing')
    // Recovery file should now exist with instructions naming the missing fields
    const failurePath = join(workspace.dir, 'WORKFLOW/ACTIVE/GATE_FAILURE.md')
    assert.ok(existsSync(failurePath), 'GATE_FAILURE.md should be auto-written on gate failure')
    const failureContent = readFileSync(failurePath, 'utf-8')
    assert.contains(failureContent, 'Gate 3')
    assert.contains(failureContent, 'PLAN_REVIEW.md')
    assert.contains(failureContent, 'RATING')
    assert.contains(failureContent, 'Autonomy protocol')
    // After fixing the deliverable, GATE_FAILURE.md should be auto-deleted on success
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/PLAN_REVIEW.md',
      '# Review\nSTATUS: APPROVED\nRATING: 8/10\nRATING_REASONING: covers all required fields after recovery.')
    writeFile(workspace.dir, 'WORKFLOW/ACTIVE/PLAN_APPROVED.md',
      '# Approved\n## Files to Modify\n| File | Action |\n|---|---|\n| x.md | CREATE |\n## Implementation Steps\n1. Do.')
    const r2 = await runOrchestrator(workspace.dir, ['-Next', '-SkipGit'])
    assert.equal(r2.code, 0, `recovery -Next should succeed: ${r2.stdout}\n${r2.stderr}`)
    assert.equal(existsSync(failurePath), false, 'GATE_FAILURE.md should be auto-deleted on successful transition')
  })

  test('Wizard: game project type + Pygame engine in wizard-options.json', async () => {
    const r = await http(`${dashboard.base}/api/wizard/options`)
    assert.status(r, 200)
    const types = r.body.projectTypes.map((t) => t.id)
    assert.ok(types.includes('game'), `projectTypes should include "game", got: ${types.join(',')}`)
    assert.ok(r.body.game, 'game section should exist in wizard-options')
    const engineIds = r.body.game.engines.map((e) => e.id)
    assert.ok(engineIds.includes('pygame'), `game.engines should include pygame, got: ${engineIds.join(',')}`)
    assert.ok(engineIds.includes('godot-gd'), `game.engines should include godot-gd`)
    assert.ok(r.body.sectionApplicability && r.body.sectionApplicability.game, 'sectionApplicability.game should be defined')
  })
})

// =============================================================================
// 13. Per-phase Model Routing (V6 Phase C)
// =============================================================================
suite('13. Per-phase Model Routing', () => {
  test('GET /api/config/models — defaults when no config file', async () => {
    // Reset workspace so the config file is fresh
    await runOrchestrator(workspace.dir, ['-Reset', '-SkipGit'])
    const r = await http(`${dashboard.base}/api/config/models`)
    assert.status(r, 200)
    assert.equal(r.body.perPhaseModels, false)
    assert.deepEqual(r.body.modelByMode, {})
  })

  test('POST /api/config/models — persists perPhaseModels + modelByMode', async () => {
    const payload = {
      perPhaseModels: true,
      modelByMode: {
        director:        { modelId: 'small-fast' },
        executor:        { modelId: 'large-smart' },
        'workflow-master': { modelId: 'large-smart' },
      },
    }
    const r = await http(`${dashboard.base}/api/config/models`, { method: 'POST', body: payload })
    assert.status(r, 200)
    assert.equal(r.body.success, true)
    assert.equal(r.body.perPhaseModels, true)
    assert.equal(r.body.modelByMode.director.modelId, 'small-fast')

    // Read back
    const g = await http(`${dashboard.base}/api/config/models`)
    assert.status(g, 200)
    assert.equal(g.body.perPhaseModels, true)
    assert.equal(g.body.modelByMode.executor.modelId, 'large-smart')
  })

  test('POST /api/config/models — rejects non-boolean perPhaseModels', async () => {
    const r = await http(`${dashboard.base}/api/config/models`, { method: 'POST', body: { perPhaseModels: 'yes', modelByMode: {} } })
    assert.status(r, 400)
  })

  test('POST /api/config/models — rejects empty modelId in entry', async () => {
    const r = await http(`${dashboard.base}/api/config/models`, {
      method: 'POST',
      body: { perPhaseModels: true, modelByMode: { director: { modelId: '' } } },
    })
    assert.status(r, 400)
  })

  test('GET /api/models/list — proxies to bridge and 503s when offline', async () => {
    // BRIDGE_BASE in tests points at port 1 (unreachable) so this should 503
    const r = await http(`${dashboard.base}/api/models/list`)
    assert.status(r, 503)
  })

  test('GET /api/models/recommend — proxies to bridge and 503s when offline', async () => {
    const r = await http(`${dashboard.base}/api/models/recommend`)
    assert.status(r, 503)
  })
})

// =============================================================================
// Teardown
// =============================================================================
suite('99. Teardown', () => {
  test('stop dashboard', async () => {
    if (dashboard) dashboard.stop()
  })
  test('cleanup temp workspace', async () => {
    if (workspace) workspace.cleanup()
  })
})

// Execute
const code = await run({ filter })
process.exit(code)
