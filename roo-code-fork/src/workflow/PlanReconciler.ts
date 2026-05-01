/**
 * PlanReconciler — turn arbitrary markdown into the strict triplet the
 * orchestrator's gates 1-3 expect: { phasePlan, detailedPlan, planReview }.
 *
 * Why? The legacy `-InjectPlan` flow in `orchestrator.ps1` writes hard-coded
 * dummy files solely to bypass gates. That works but loses the user's intent.
 * This reconciler:
 *
 *   - Preserves the original markdown verbatim under `## Original Plan`
 *   - Synthesises gate-compliant headings (`## Phase N`, `## Files to
 *     Modify`, `## Implementation Steps`, `STATUS: APPROVED`) using the
 *     interpreted PRD fields when available
 *   - Mirrors `buildFeatureRequest()`'s output shape so the Director sees
 *     the same kind of FEATURE_REQUEST.md regardless of input source
 *
 * Pure logic, NO LLM call. Drop-in for both the dashboard `/api/ingest/prd`
 * route and the orchestrator's `-InjectPlan` rewrite.
 */

import type { InterpretedPrd } from "./PrdInterpreter"

export interface ReconciledPlan {
	phasePlan: string
	detailedPlan: string
	planReview: string
	warnings: string[]
}

/**
 * Reconcile any markdown source into a triplet that satisfies gates 1-3.
 *
 * Gate regexes from GateValidator.ts (the reconciler MUST satisfy them):
 *   Gate 1: /## Phase \d/                                            (PHASE_PLAN.md)
 *   Gate 2: /## (Files to Modify|Implementation Steps)/             (DETAILED_PLAN.md) — we satisfy BOTH for safety
 *   Gate 3: /STATUS:\s*(APPROVED|NEEDS_REVISION)/                   (PLAN_REVIEW.md)
 */
export function reconcileToPlan(source: string, interpreted: InterpretedPrd): ReconciledPlan {
	const warnings: string[] = []
	const summary = interpreted.summary.value || "(no summary detected — see Original Plan below)"
	const projectName = interpreted.projectName.value || "Untitled Project"

	if (!interpreted.summary.value) warnings.push("Summary could not be extracted — using fallback")
	if (interpreted.successCriteria.confidence < 0.4) warnings.push("Success criteria confidence is low; review before approving")

	// --- PHASE_PLAN.md ----------------------------------------------------
	// Gate 1 requires `## Phase N` somewhere. We write a single high-level
	// phase that wraps the entire scope (matches what -Plan wizard does).
	const phasePlan = [
		`# Phase Plan — ${projectName}`,
		"",
		"## Feature",
		summary,
		"",
		"---",
		"",
		"## Phase 1: Implementation",
		`**Goal:** Deliver "${summary.replace(/\s+/g, " ").slice(0, 200)}"`,
		"**Scope:** Single deliverable derived from the reconciled plan below.",
		"**Dependencies:** As listed in the Original Plan.",
		"**Success Criteria:**",
		formatSuccessCriteria(interpreted.successCriteria.value, projectName),
		"",
		"---",
		"",
		"_Reconciled from external markdown by `PlanReconciler.reconcileToPlan`. The original document is preserved verbatim in `DETAILED_PLAN.md` under `## Original Plan`._",
		"",
	].join("\n")

	// --- DETAILED_PLAN.md -------------------------------------------------
	// Gate 2 needs at least one of `## Files to Modify` / `## Implementation Steps`.
	// We satisfy BOTH so any future stricter gate variant still passes.
	// Original source is appended verbatim under `## Original Plan` so no intent is lost.
	const detailedPlan = [
		`# Detailed Plan — ${projectName}`,
		"",
		"## Summary",
		summary,
		"",
		"## Files to Modify",
		"| File | Action | Purpose |",
		"|------|--------|---------|",
		"| _to be enumerated by the Director from the Original Plan below_ | _MODIFY / CREATE_ | _per the source markdown_ |",
		"",
		"## Implementation Steps",
		formatImplementationStepsFromOriginal(source) ||
			"1. Review the Original Plan section below.\n2. Enumerate concrete file-level changes.\n3. Implement and test each step.",
		"",
		"## Risk Assessment",
		"- LOW: Reconciliation is best-effort; the Original Plan is the source of truth.",
		"",
		"## Test Strategy",
		"- Verify each implementation step produces the deliverable described in the Original Plan.",
		"",
		"---",
		"",
		"## Original Plan (verbatim)",
		"",
		"> The following content is the user's original markdown, preserved without modification.",
		"",
		source.trim(),
		"",
	].join("\n")

	// --- PLAN_REVIEW.md ---------------------------------------------------
	// Gate 3 needs `STATUS: APPROVED` or `STATUS: NEEDS_REVISION`.
	// Reconciliation always produces APPROVED — the user explicitly chose to
	// inject this plan, so we trust the source.
	const planReview = [
		`# Plan Review — ${projectName}`,
		"",
		"STATUS: APPROVED",
		"",
		"## Reviewer Notes",
		`Plan was reconciled from external markdown by \`PlanReconciler\`. The Director must respect the **Original Plan** section verbatim and use the synthesised headings (Files to Modify, Implementation Steps) as a structured map, not a replacement.`,
		"",
		"## Reconciliation Warnings",
		warnings.length > 0
			? warnings.map((w) => `- ${w}`).join("\n")
			: "_None — reconciliation completed cleanly._",
		"",
	].join("\n")

	return { phasePlan, detailedPlan, planReview, warnings }
}

/**
 * Build a FEATURE_REQUEST.md body that mirrors `buildFeatureRequest()`'s
 * output shape from `workflow-dashboard/server.js`. Used when the user
 * supplies a PRD (not a plan) and we want the Director to consume it via
 * the normal cycle path.
 */
export function reconcileToFeatureRequest(interpreted: InterpretedPrd, sourceMd: string): string {
	const lines: string[] = []
	const projectName = interpreted.projectName.value || "Untitled Project"
	const summary = interpreted.summary.value || "(see Original PRD below)"

	lines.push("# Feature Request — Imported PRD")
	lines.push("")
	lines.push(`## What to build`)
	lines.push("")
	lines.push(summary)
	lines.push("")

	const blocks: [string, string][] = []
	if (projectName) blocks.push(["Project name", projectName])
	if (interpreted.projectType.value) blocks.push(["Project type", interpreted.projectType.value])
	if (interpreted.stackHints.value.length > 0) {
		blocks.push(["Stack hints (from PRD)", interpreted.stackHints.value.join(", ")])
	}

	if (blocks.length > 0) {
		lines.push("## Stack & decisions (interpreted from PRD)")
		lines.push("")
		lines.push("| Item | Choice |")
		lines.push("|------|--------|")
		for (const [k, v] of blocks) lines.push(`| **${k}** | ${v} |`)
		lines.push("")
	}

	if (interpreted.dataModel.value) {
		lines.push("## Data model / entities")
		lines.push("")
		lines.push(interpreted.dataModel.value)
		lines.push("")
	}

	if (interpreted.constraints.value) {
		lines.push("## Constraints / requirements")
		lines.push("")
		lines.push(interpreted.constraints.value)
		lines.push("")
	}

	lines.push("## Success criteria")
	lines.push("")
	if (interpreted.successCriteria.value) {
		lines.push(interpreted.successCriteria.value)
	} else {
		lines.push("- Project scaffolds cleanly with the stack derived from the imported PRD.")
		lines.push("- Core features described in the PRD are functional and demoable.")
		lines.push("- Tests cover the main user stories.")
	}
	lines.push("")

	lines.push("---")
	lines.push("")
	lines.push("## Original PRD (verbatim)")
	lines.push("")
	lines.push("> Imported via `/api/ingest/prd`. The Director MUST read this section in full when planning.")
	lines.push("")
	lines.push(sourceMd.trim())
	lines.push("")

	return lines.join("\n")
}

// =============================================================================
// Internals
// =============================================================================

function formatSuccessCriteria(raw: string, projectName: string): string {
	if (!raw) {
		return [
			`- ${projectName} scaffolds cleanly with the chosen stack.`,
			`- Core feature described above is functional and demoable.`,
			`- Tests for the chosen unit framework pass on a fresh checkout.`,
		].join("\n")
	}
	// If the user wrote bullet-points already, keep them. Otherwise wrap as one bullet.
	const trimmed = raw.trim()
	if (/^[-*]\s/m.test(trimmed)) return trimmed
	return `- ${trimmed.replace(/\s+/g, " ")}`
}

/**
 * Try to harvest implementation steps from the source. We look for any
 * section already titled like "Implementation Steps" or "Steps" and lift
 * its body. If nothing matches we return null and the caller writes a
 * stub.
 */
function formatImplementationStepsFromOriginal(source: string): string | null {
	const lines = source.split(/\r?\n/)
	const headingPatterns = [/implementation\s+steps?/i, /^steps?$/i, /tasks?/i, /work\s+items?/i]
	let inSection = false
	const buf: string[] = []
	for (const line of lines) {
		const m = line.match(/^(#{2,6})\s+(.+?)\s*$/)
		if (m) {
			if (inSection) break
			if (headingPatterns.some((p) => p.test(m[2]))) {
				inSection = true
				continue
			}
		}
		if (inSection) buf.push(line)
	}
	const joined = buf.join("\n").trim()
	return joined.length > 10 ? joined : null
}
