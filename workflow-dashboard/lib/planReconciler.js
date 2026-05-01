/**
 * PlanReconciler (CommonJS mirror) — produces gate-compliant {phasePlan,
 * detailedPlan, planReview} triplets from any markdown source. Used by the
 * dashboard's /api/ingest/prd?mode=reconcile endpoint and (via that endpoint)
 * by orchestrator.ps1's rewritten -InjectPlan branch.
 *
 * Mirrors `roo-code-fork/src/workflow/PlanReconciler.ts`. Pure logic.
 */

'use strict';

function reconcileToPlan(source, interpreted) {
  const warnings = [];
  const summary = (interpreted.summary && interpreted.summary.value) || '(no summary detected — see Original Plan below)';
  const projectName = (interpreted.projectName && interpreted.projectName.value) || 'Untitled Project';

  if (!interpreted.summary || !interpreted.summary.value) warnings.push('Summary could not be extracted — using fallback');
  if (interpreted.successCriteria && interpreted.successCriteria.confidence < 0.4) warnings.push('Success criteria confidence is low; review before approving');

  const phasePlan = [
    `# Phase Plan — ${projectName}`,
    '',
    '## Feature',
    summary,
    '',
    '---',
    '',
    '## Phase 1: Implementation',
    `**Goal:** Deliver "${summary.replace(/\s+/g, ' ').slice(0, 200)}"`,
    '**Scope:** Single deliverable derived from the reconciled plan below.',
    '**Dependencies:** As listed in the Original Plan.',
    '**Success Criteria:**',
    formatSuccessCriteria((interpreted.successCriteria && interpreted.successCriteria.value) || '', projectName),
    '',
    '---',
    '',
    '_Reconciled from external markdown by `PlanReconciler.reconcileToPlan`. The original document is preserved verbatim in `DETAILED_PLAN.md` under `## Original Plan`._',
    '',
  ].join('\n');

  const detailedPlan = [
    `# Detailed Plan — ${projectName}`,
    '',
    '## Summary',
    summary,
    '',
    '## Files to Modify',
    '| File | Action | Purpose |',
    '|------|--------|---------|',
    '| _to be enumerated by the Director from the Original Plan below_ | _MODIFY / CREATE_ | _per the source markdown_ |',
    '',
    '## Implementation Steps',
    formatImplementationStepsFromOriginal(source) ||
      '1. Review the Original Plan section below.\n2. Enumerate concrete file-level changes.\n3. Implement and test each step.',
    '',
    '## Risk Assessment',
    '- LOW: Reconciliation is best-effort; the Original Plan is the source of truth.',
    '',
    '## Test Strategy',
    '- Verify each implementation step produces the deliverable described in the Original Plan.',
    '',
    '---',
    '',
    '## Original Plan (verbatim)',
    '',
    "> The following content is the user's original markdown, preserved without modification.",
    '',
    source.trim(),
    '',
  ].join('\n');

  const planReview = [
    `# Plan Review — ${projectName}`,
    '',
    'STATUS: APPROVED',
    '',
    '## Reviewer Notes',
    'Plan was reconciled from external markdown by `PlanReconciler`. The Director must respect the **Original Plan** section verbatim and use the synthesised headings (Files to Modify, Implementation Steps) as a structured map, not a replacement.',
    '',
    '## Reconciliation Warnings',
    warnings.length > 0 ? warnings.map((w) => `- ${w}`).join('\n') : '_None — reconciliation completed cleanly._',
    '',
  ].join('\n');

  return { phasePlan, detailedPlan, planReview, warnings };
}

function reconcileToFeatureRequest(interpreted, sourceMd) {
  const lines = [];
  const projectName = (interpreted.projectName && interpreted.projectName.value) || 'Untitled Project';
  const summary = (interpreted.summary && interpreted.summary.value) || '(see Original PRD below)';

  lines.push('# Feature Request — Imported PRD');
  lines.push('');
  lines.push('## What to build');
  lines.push('');
  lines.push(summary);
  lines.push('');

  const blocks = [];
  if (projectName) blocks.push(['Project name', projectName]);
  if (interpreted.projectType && interpreted.projectType.value) blocks.push(['Project type', interpreted.projectType.value]);
  if (interpreted.stackHints && interpreted.stackHints.value && interpreted.stackHints.value.length > 0) {
    blocks.push(['Stack hints (from PRD)', interpreted.stackHints.value.join(', ')]);
  }
  if (blocks.length > 0) {
    lines.push('## Stack & decisions (interpreted from PRD)');
    lines.push('');
    lines.push('| Item | Choice |');
    lines.push('|------|--------|');
    for (const [k, v] of blocks) lines.push(`| **${k}** | ${v} |`);
    lines.push('');
  }
  if (interpreted.dataModel && interpreted.dataModel.value) {
    lines.push('## Data model / entities');
    lines.push('');
    lines.push(interpreted.dataModel.value);
    lines.push('');
  }
  if (interpreted.constraints && interpreted.constraints.value) {
    lines.push('## Constraints / requirements');
    lines.push('');
    lines.push(interpreted.constraints.value);
    lines.push('');
  }
  lines.push('## Success criteria');
  lines.push('');
  if (interpreted.successCriteria && interpreted.successCriteria.value) {
    lines.push(interpreted.successCriteria.value);
  } else {
    lines.push('- Project scaffolds cleanly with the stack derived from the imported PRD.');
    lines.push('- Core features described in the PRD are functional and demoable.');
    lines.push('- Tests cover the main user stories.');
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Original PRD (verbatim)');
  lines.push('');
  lines.push('> Imported via `/api/ingest/prd`. The Director MUST read this section in full when planning.');
  lines.push('');
  lines.push(sourceMd.trim());
  lines.push('');
  return lines.join('\n');
}

function formatSuccessCriteria(raw, projectName) {
  if (!raw) {
    return [
      `- ${projectName} scaffolds cleanly with the chosen stack.`,
      '- Core feature described above is functional and demoable.',
      '- Tests for the chosen unit framework pass on a fresh checkout.',
    ].join('\n');
  }
  const trimmed = raw.trim();
  if (/^[-*]\s/m.test(trimmed)) return trimmed;
  return `- ${trimmed.replace(/\s+/g, ' ')}`;
}

function formatImplementationStepsFromOriginal(source) {
  const lines = source.split(/\r?\n/);
  const headingPatterns = [/implementation\s+steps?/i, /^steps?$/i, /tasks?/i, /work\s+items?/i];
  let inSection = false;
  const buf = [];
  for (const line of lines) {
    const m = line.match(/^(#{2,6})\s+(.+?)\s*$/);
    if (m) {
      if (inSection) break;
      if (headingPatterns.some((p) => p.test(m[2]))) {
        inSection = true;
        continue;
      }
    }
    if (inSection) buf.push(line);
  }
  const joined = buf.join('\n').trim();
  return joined.length > 10 ? joined : null;
}

module.exports = { reconcileToPlan, reconcileToFeatureRequest };
