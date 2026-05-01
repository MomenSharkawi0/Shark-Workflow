import * as fs from "fs"
import * as path from "path"

/**
 * ContextInjector
 *
 * Automatically injects relevant workflow context files into the system
 * prompt for each mode. Ensures the AI agent always has fresh context.
 *
 * Supports:
 * - Configurable per-mode file lists (via WorkflowConfig)
 * - File size guards to prevent token budget blowout
 * - Parallel track modes (EXECUTION_BACKEND / EXECUTION_FRONTEND)
 */
export class ContextInjector {
    private readonly modeContextFiles: Record<string, string[]>
    private readonly maxFileSizeKb: number

    private static readonly DEFAULT_CONTEXT_FILES: Record<string, string[]> = {
        "director": [
            "WORKFLOW/ORCHESTRATION_STATUS.json",
            "WORKFLOW/ACTIVE/CURRENT_INSTRUCTION.md",
            "WORKFLOW/ACTIVE/PHASE_PLAN.md",
            "WORKFLOW/ACTIVE/DETAILED_PLAN.md",
            "WORKFLOW/LESSONS_LEARNED.md",
            "WORKFLOW/PHASE_DNA.md",
            "WORKFLOW/GOLDEN_RULES.md",
            "WORKFLOW/SELF_REVIEW_CHECKLIST.md",
        ],
        "planner": [
            "WORKFLOW/ORCHESTRATION_STATUS.json",
            "WORKFLOW/ACTIVE/CURRENT_INSTRUCTION.md",
            "WORKFLOW/ACTIVE/PHASE_PLAN.md",
            "WORKFLOW/LESSONS_LEARNED.md",
            "WORKFLOW/PHASE_DNA.md",
            "WORKFLOW/GOLDEN_RULES.md",
            "WORKFLOW/ACTIVE/QUALITY_GATES.md",
        ],
        "executor": [
            "WORKFLOW/ORCHESTRATION_STATUS.json",
            "WORKFLOW/ACTIVE/CURRENT_INSTRUCTION.md",
            "WORKFLOW/ACTIVE/PLAN_APPROVED.md",
            "WORKFLOW/LESSONS_LEARNED.md",
        ],
        "workflow-master": [
            "WORKFLOW/ORCHESTRATION_STATUS.json",
            "WORKFLOW/ACTIVE/CURRENT_INSTRUCTION.md",
            "WORKFLOW/ACTIVE/PHASE_PLAN.md",
            "WORKFLOW/ACTIVE/DETAILED_PLAN.md",
            "WORKFLOW/LESSONS_LEARNED.md",
            "WORKFLOW/PHASE_DNA.md",
            "WORKFLOW/GOLDEN_RULES.md",
            "WORKFLOW/SELF_REVIEW_CHECKLIST.md",
            "WORKFLOW/ACTIVE/QUALITY_GATES.md",
        ],
        // V6 Phase A — prd-interpreter mode is invoked by the bridge to extract
        // structured fields from arbitrary PRD/plan markdown. It only needs the
        // wizard's option vocabulary so it knows the canonical field names.
        "prd-interpreter": [
            "workflow-dashboard/wizard-options.json",
        ],
    }

    constructor(
        contextFiles?: Record<string, string[]>,
        maxFileSizeKb: number = 50
    ) {
        this.modeContextFiles = contextFiles || ContextInjector.DEFAULT_CONTEXT_FILES
        this.maxFileSizeKb = maxFileSizeKb
    }

    getInjectedContext(mode: string, workspaceRoot: string): string {
        const files = this.modeContextFiles[mode]
        if (!files || files.length === 0) return ""

        const parts: string[] = []

        for (const relativePath of files) {
            const fullPath = path.join(workspaceRoot, relativePath)
            if (!fs.existsSync(fullPath)) continue

            try {
                const stats = fs.statSync(fullPath)
                const fileSizeKb = stats.size / 1024

                if (fileSizeKb > this.maxFileSizeKb) {
                    // Inject a truncated summary for oversized files
                    const content = fs.readFileSync(fullPath, "utf8")
                    const truncated = content.substring(0, this.maxFileSizeKb * 1024)
                    parts.push(
                        `\n\n<!-- AUTO-INJECTED: ${relativePath} (TRUNCATED — ${Math.round(fileSizeKb)}KB exceeds ${this.maxFileSizeKb}KB limit) -->\n${truncated}\n<!-- ... truncated ... -->`
                    )
                    console.warn(`[ContextInjector] ${relativePath} truncated (${Math.round(fileSizeKb)}KB > ${this.maxFileSizeKb}KB)`)
                } else {
                    const content = fs.readFileSync(fullPath, "utf8")
                    parts.push(`\n\n<!-- AUTO-INJECTED: ${relativePath} -->\n${content}`)
                }
            } catch {
                console.warn(`[ContextInjector] Could not read ${relativePath}`)
            }
        }

        return parts.join("")
    }

    getContextFiles(mode: string): string[] {
        return this.modeContextFiles[mode] || []
    }
}
