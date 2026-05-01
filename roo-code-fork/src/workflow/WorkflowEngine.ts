/**
 * WorkflowEngine.ts — AI-Powered Workflow Orchestrator
 * 
 * Replaces PowerShell orchestrator with an intelligent engine
 * that manages state transitions, AI evaluation, and autonomous cycling.
 * Lives inside the Roo Code extension process.
 */

import * as fs from "fs"
import * as path from "path"
import type { ClineProviderLike } from "./index"
import { StackDetector, type DetectedStack } from "./StackDetector"

// ============================================================================
// TYPES
// ============================================================================

export type WorkflowPhase =
    | "INIT"
    | "PHASE_PLANNING"
    | "DETAILED_PLANNING"
    | "PLAN_REVIEW"
    | "EXECUTION"
    | "EXECUTION_REVIEW"
    | "ARCHIVE"
    | "COMPLETE"

export type AutonomyLevel = "manual" | "semi-auto" | "full-auto"

export interface EngineState {
    phase: WorkflowPhase
    previousPhase: WorkflowPhase | null
    autonomy: AutonomyLevel
    isRunning: boolean
    isPaused: boolean
    cycleId: string
    cycleStart: string
    featureRequest: string
    currentMode: string
    transitionCount: number
    retryCount: number
    maxRetries: number
    lastEvaluation: EvaluationResult | null
    lastPrompt: string
    eventLog: EngineEvent[]
    error: string | null
    detectedStack: DetectedStack | null
}

export interface EvaluationResult {
    phase: WorkflowPhase
    pass: boolean
    score: number // 0-100
    feedback: string
    missingItems: string[]
    timestamp: string
}

export interface EngineEvent {
    type: "info" | "mode" | "phase" | "eval" | "error" | "task" | "file"
    message: string
    timestamp: string
    data?: any
}

// Phase configuration: what mode, what file is expected, what prompt context to use
interface PhaseConfig {
    mode: string
    expectedOutput: string
    promptTemplate: string
    evaluationCriteria: string[]
}

const PHASE_CONFIG: Record<WorkflowPhase, PhaseConfig> = {
    INIT: {
        mode: "director",
        expectedOutput: "FEATURE_REQUEST.md",
        promptTemplate: "Waiting for feature request...",
        evaluationCriteria: ["Feature request exists and is detailed"],
    },
    PHASE_PLANNING: {
        mode: "director",
        expectedOutput: "PHASE_PLAN.md",
        promptTemplate: `You are the Director. Read the following files and create a comprehensive PHASE_PLAN.md:
- WORKFLOW/ACTIVE/FEATURE_REQUEST.md
- WORKFLOW/LESSONS_LEARNED.md
- WORKFLOW/PHASE_DNA.md

The PHASE_PLAN.md must include:
1. Objective & scope
2. Success criteria
3. Phase breakdown with deliverables
4. Risk assessment
5. Estimated complexity

Write the plan to WORKFLOW/ACTIVE/PHASE_PLAN.md`,
        evaluationCriteria: [
            "Has clear objective",
            "Has success criteria",
            "Has phase breakdown",
            "Has risk assessment",
        ],
    },
    DETAILED_PLANNING: {
        mode: "planner",
        expectedOutput: "DETAILED_PLAN.md",
        promptTemplate: `You are the Planner. Read the PHASE_PLAN.md and create a DETAILED_PLAN.md with:
1. Step-by-step implementation tasks
2. File-level changes needed
3. Dependencies between tasks
4. Testing strategy
5. Rollback plan

Read: WORKFLOW/ACTIVE/PHASE_PLAN.md, WORKFLOW/LESSONS_LEARNED.md
Write to: WORKFLOW/ACTIVE/DETAILED_PLAN.md`,
        evaluationCriteria: [
            "Has step-by-step tasks",
            "Has file-level changes",
            "Has testing strategy",
        ],
    },
    PLAN_REVIEW: {
        mode: "director",
        expectedOutput: "PLAN_APPROVED.md",
        promptTemplate: `You are the Director reviewing the detailed plan.
Read WORKFLOW/ACTIVE/DETAILED_PLAN.md carefully.

Evaluate:
1. Completeness — does it cover all requirements?
2. Feasibility — are the steps actionable?
3. Quality — follows best practices?

If APPROVED: Copy DETAILED_PLAN.md to PLAN_APPROVED.md
If NEEDS_REVISION: Write feedback in PLAN_REVIEW.md with specific changes needed.`,
        evaluationCriteria: [
            "Plan reviewed",
            "Decision made (APPROVED or NEEDS_REVISION)",
            "PLAN_APPROVED.md exists if approved",
        ],
    },
    EXECUTION: {
        mode: "executor",
        expectedOutput: "EXECUTION_REPORT.md",
        promptTemplate: `You are the Executor. Read WORKFLOW/ACTIVE/PLAN_APPROVED.md and implement exactly what is planned.

Rules:
- Follow the plan precisely
- Do NOT add features not in the plan
- Write clean, tested code
- Document any deviations

When done, write WORKFLOW/ACTIVE/EXECUTION_REPORT.md summarizing what was implemented.`,
        evaluationCriteria: [
            "Code implemented",
            "Execution report written",
            "Follows the plan",
        ],
    },
    EXECUTION_REVIEW: {
        mode: "director",
        expectedOutput: "EXECUTION_REVIEW.md",
        promptTemplate: `You are the Director reviewing the execution.
Read WORKFLOW/ACTIVE/EXECUTION_REPORT.md and WORKFLOW/ACTIVE/EXECUTION_DIFF.diff.
Verify:
1. All planned tasks completed
2. Code quality acceptable
3. No regressions introduced

Update WORKFLOW/LESSONS_LEARNED.md with new learnings.
Update WORKFLOW/PHASE_DNA.md if patterns discovered.
Write WORKFLOW/ACTIVE/EXECUTION_REVIEW.md with your assessment.`,
        evaluationCriteria: [
            "Execution reviewed",
            "Lessons updated",
            "Assessment written",
        ],
    },
    ARCHIVE: {
        mode: "director",
        expectedOutput: "",
        promptTemplate: `Archive phase: Review all ACTIVE files and confirm learnings are captured. This phase will auto-complete.`,
        evaluationCriteria: ["Files reviewed"],
    },
    COMPLETE: {
        mode: "director",
        expectedOutput: "",
        promptTemplate: "Workflow complete. All phases finished successfully.",
        evaluationCriteria: [],
    },
}

const PHASE_ORDER: WorkflowPhase[] = [
    "INIT",
    "PHASE_PLANNING",
    "DETAILED_PLANNING",
    "PLAN_REVIEW",
    "EXECUTION",
    "EXECUTION_REVIEW",
    "ARCHIVE",
    "COMPLETE",
]

// ============================================================================
// WORKFLOW ENGINE
// ============================================================================

export class WorkflowEngine {
    private state: EngineState
    private provider: ClineProviderLike
    private workspaceRoot: string
    private listeners: Array<(event: EngineEvent) => void> = []
    private autopilotTimer: ReturnType<typeof setTimeout> | null = null
    private fileWatchInterval: ReturnType<typeof setInterval> | null = null
    private stackDetector: StackDetector

    constructor(provider: ClineProviderLike, workspaceRoot: string) {
        this.provider = provider
        this.workspaceRoot = workspaceRoot
        this.stackDetector = new StackDetector(workspaceRoot)
        this.state = this.loadState()
        // Auto-detect stack on init
        try {
            this.state.detectedStack = this.stackDetector.detect()
            console.log(`[WorkflowEngine] Stack detected: ${this.state.detectedStack.summary}`)
        } catch (err) {
            console.warn(`[WorkflowEngine] Stack detection failed: ${err}`)
        }
    }

    // ========================================================================
    // STATE MANAGEMENT
    // ========================================================================

    private getStatusPath(): string {
        return path.join(this.workspaceRoot, "WORKFLOW", "ORCHESTRATION_STATUS.json")
    }
    private getActivePath(filename: string): string {
        return path.join(this.workspaceRoot, "WORKFLOW", "ACTIVE", filename)
    }
    private getWorkflowPath(filename: string): string {
        return path.join(this.workspaceRoot, "WORKFLOW", filename)
    }

    private loadState(): EngineState {
        const statusPath = this.getStatusPath()
        let base: EngineState = {
            phase: "INIT",
            previousPhase: null,
            autonomy: "manual",
            isRunning: false,
            isPaused: false,
            cycleId: this.generateId(),
            cycleStart: new Date().toISOString(),
            featureRequest: "",
            currentMode: "director",
            transitionCount: 0,
            retryCount: 0,
            maxRetries: 3,
            lastEvaluation: null,
            lastPrompt: "",
            eventLog: [],
            error: null,
            detectedStack: null,
        }
        try {
            if (fs.existsSync(statusPath)) {
                const raw = JSON.parse(fs.readFileSync(statusPath, "utf-8"))
                base.phase = raw.currentState || "INIT"
                base.previousPhase = raw.previousState || null
                base.cycleStart = raw.cycleStart || base.cycleStart
                base.transitionCount = raw.transitionCount || 0
                base.retryCount = raw.retryCount || 0
                base.autonomy = raw.autonomy || "manual"
                base.featureRequest = raw.featureRequest || ""
                base.isRunning = raw.isRunning || false
            }
        } catch {}
        return base
    }

    private saveState(): void {
        const statusPath = this.getStatusPath()
        const dir = path.dirname(statusPath)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        const data = {
            currentState: this.state.phase,
            previousState: this.state.previousPhase,
            cycleStart: this.state.cycleStart,
            lastTransition: new Date().toISOString(),
            transitionCount: this.state.transitionCount,
            retryCount: this.state.retryCount,
            status: this.state.phase === "COMPLETE" ? "COMPLETE" : this.state.error ? "BLOCKED" : "IN_PROGRESS",
            blockedReason: this.state.error || "",
            autopilot: this.state.autonomy === "full-auto",
            autonomy: this.state.autonomy,
            featureRequest: this.state.featureRequest,
            isRunning: this.state.isRunning,
            nextMode: PHASE_CONFIG[this.state.phase]?.mode || "director",
            nextAction: PHASE_CONFIG[this.state.phase]?.promptTemplate?.substring(0, 100) || "",
            detectedStack: this.state.detectedStack?.summary || "Unknown",
        }
        fs.writeFileSync(statusPath, JSON.stringify(data, null, 2), "utf-8")
    }

    private generateId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substring(2, 6)
    }

    // ========================================================================
    // EVENT SYSTEM
    // ========================================================================

    private emit(type: EngineEvent["type"], message: string, data?: any): void {
        const event: EngineEvent = {
            type, message, timestamp: new Date().toISOString(), data,
        }
        this.state.eventLog.push(event)
        // Keep last 200 events
        if (this.state.eventLog.length > 200) {
            this.state.eventLog = this.state.eventLog.slice(-200)
        }
        this.listeners.forEach((fn) => {
            try { fn(event) } catch {}
        })
        console.log(`[WorkflowEngine] [${type}] ${message}`)
    }

    onEvent(listener: (event: EngineEvent) => void): () => void {
        this.listeners.push(listener)
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener)
        }
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    getState(): EngineState {
        return { ...this.state }
    }

    /** Start a new workflow cycle */
    /**
     * Start a new cycle. V6 Phase A extends `options` with two PRD-ingestion
     * paths:
     *
     *   - `prefilledFeatureRequest` — use this verbatim instead of building one
     *     from `featureRequest`. Lets the dashboard's PRD interpreter hand us a
     *     fully-formed FEATURE_REQUEST.md that already mirrors the wizard's
     *     output shape.
     *   - `reconciledPlan` — gate-compliant {phasePlan, detailedPlan,
     *     planReview} triplet from `PlanReconciler`. When provided, write all
     *     three into `WORKFLOW/ACTIVE/` so the engine can fast-forward past
     *     PHASE_PLANNING and DETAILED_PLANNING.
     */
    async startCycle(
        featureRequest: string,
        options?: {
            manualStack?: string
            prefilledFeatureRequest?: string
            reconciledPlan?: { phasePlan: string; detailedPlan: string; planReview: string }
        },
    ): Promise<{ success: boolean; error?: string }> {
        if (this.state.isRunning) {
            return { success: false, error: "A cycle is already running. Abort it first." }
        }

        this.state = {
            ...this.state,
            phase: "INIT",
            previousPhase: null,
            isRunning: true,
            isPaused: false,
            cycleId: this.generateId(),
            cycleStart: new Date().toISOString(),
            featureRequest,
            transitionCount: 0,
            retryCount: 0,
            lastEvaluation: null,
            error: null,
            eventLog: [],
        }

        // Write feature request file
        const activeDir = path.join(this.workspaceRoot, "WORKFLOW", "ACTIVE")
        if (!fs.existsSync(activeDir)) fs.mkdirSync(activeDir, { recursive: true })

        // Append manual stack to feature request if provided (useful for new empty projects)
        let finalRequest = featureRequest
        if (options?.manualStack) {
            finalRequest += `\n\n## Requested Technology Stack\n${options.manualStack}`
        }

        // Phase A: prefilledFeatureRequest wins over the synthesised wrapper —
        // the PRD interpreter already produced a full, well-formed document.
        const content = options?.prefilledFeatureRequest
            ? options.prefilledFeatureRequest
            : `# Feature Request\n\n**Submitted:** ${new Date().toLocaleString()}\n\n## Description\n\n${finalRequest}\n`
        fs.writeFileSync(this.getActivePath("FEATURE_REQUEST.md"), content, "utf-8")

        // Phase A: when a reconciled plan is supplied, materialise the triplet
        // so gates 1-3 pass with real content rather than the legacy dummies.
        if (options?.reconciledPlan) {
            fs.writeFileSync(this.getActivePath("PHASE_PLAN.md"),    options.reconciledPlan.phasePlan, "utf-8")
            fs.writeFileSync(this.getActivePath("DETAILED_PLAN.md"), options.reconciledPlan.detailedPlan, "utf-8")
            fs.writeFileSync(this.getActivePath("PLAN_REVIEW.md"),   options.reconciledPlan.planReview, "utf-8")
            // PLAN_APPROVED.md mirrors DETAILED_PLAN.md when the reconciler approved.
            fs.writeFileSync(this.getActivePath("PLAN_APPROVED.md"), options.reconciledPlan.detailedPlan, "utf-8")
            this.emit("info", "Reconciled plan applied: PHASE_PLAN, DETAILED_PLAN, PLAN_REVIEW (APPROVED), PLAN_APPROVED written")
        }

        this.emit("info", `Cycle started: ${finalRequest.substring(0, 80)}...`)

        // Advance to first real phase
        await this.advancePhase()

        // Start autopilot if enabled
        if (this.state.autonomy === "full-auto") {
            this.startAutopilotLoop()
        }

        this.saveState()
        return { success: true }
    }

    /** Advance to next phase */
    async advancePhase(): Promise<{ success: boolean; phase: WorkflowPhase; reason?: string }> {
        const currentIdx = PHASE_ORDER.indexOf(this.state.phase)
        if (currentIdx >= PHASE_ORDER.length - 1) {
            return { success: false, phase: this.state.phase, reason: "Already at COMPLETE" }
        }

        const nextPhase = PHASE_ORDER[currentIdx + 1]
        this.state.previousPhase = this.state.phase
        this.state.phase = nextPhase
        this.state.transitionCount++
        this.state.error = null

        const config = PHASE_CONFIG[nextPhase]
        this.state.currentMode = config.mode

        // Switch agent mode
        if (this.provider.setMode) {
            try {
                await this.provider.setMode(config.mode)
                this.emit("mode", `Mode switched to ${config.mode.toUpperCase()}`)
            } catch (err) {
                this.emit("error", `Failed to switch mode: ${err}`)
            }
        }

        this.emit("phase", `Phase advanced: ${this.state.previousPhase} → ${nextPhase}`)

        // In semi-auto or full-auto, send the prompt automatically
        if (this.state.autonomy !== "manual" && nextPhase !== "COMPLETE") {
            const prompt = await this.generatePrompt()
            if (prompt) {
                try {
                    const currentTask = this.provider.getCurrentTask ? this.provider.getCurrentTask() : null
                    if (currentTask && this.provider.postMessageToWebview) {
                        // Send message to existing chat thread
                        await this.provider.postMessageToWebview({
                            type: "invoke",
                            invoke: "sendMessage",
                            text: prompt
                        })
                    } else if (this.provider.createTask) {
                        // Start a new chat thread
                        await this.provider.createTask(prompt)
                    }
                    this.state.lastPrompt = prompt
                    this.emit("task", `Auto-sent prompt for ${nextPhase}`)
                } catch (err) {
                    this.emit("error", `Failed to send prompt: ${err}`)
                }
            }
        }

        if (nextPhase === "COMPLETE") {
            this.state.isRunning = false
            this.stopAutopilotLoop()
            this.emit("info", "Workflow cycle COMPLETE.")
            this.archiveActiveFiles()
        }

        this.saveState()
        return { success: true, phase: nextPhase }
    }

    /** Retry current phase */
    async retryPhase(): Promise<{ success: boolean; error?: string }> {
        if (this.state.retryCount >= this.state.maxRetries) {
            this.state.error = `Max retries (${this.state.maxRetries}) reached for phase ${this.state.phase}`
            this.state.isPaused = true
            this.saveState()
            return { success: false, error: this.state.error }
        }

        this.state.retryCount++
        this.state.error = null
        this.emit("info", `Retrying phase ${this.state.phase} (attempt ${this.state.retryCount})`)

        // Re-send prompt with retry context
        const prompt = await this.generatePrompt(true)
        if (prompt) {
            try {
                const currentTask = this.provider.getCurrentTask ? this.provider.getCurrentTask() : null
                if (currentTask && this.provider.postMessageToWebview) {
                    // Send to existing thread
                    await this.provider.postMessageToWebview({
                        type: "invoke",
                        invoke: "sendMessage",
                        text: prompt
                    })
                } else if (this.provider.createTask) {
                    await this.provider.createTask(prompt)
                }
                this.state.lastPrompt = prompt
                this.emit("task", `Retry prompt sent for ${this.state.phase}`)
            } catch (err) {
                this.emit("error", `Failed to send retry prompt: ${err}`)
            }
        }

        this.saveState()
        return { success: true }
    }

    /** Evaluate current phase output using AI logic */
    async evaluatePhase(useLLM: boolean = false): Promise<EvaluationResult> {
        const config = PHASE_CONFIG[this.state.phase]
        const result: EvaluationResult = {
            phase: this.state.phase,
            pass: false,
            score: 0,
            feedback: "",
            missingItems: [],
            timestamp: new Date().toISOString(),
        }

        // Check if expected output file exists
        if (config.expectedOutput) {
            const filePath = this.getActivePath(config.expectedOutput)
            if (!fs.existsSync(filePath)) {
                result.feedback = `Expected output file ${config.expectedOutput} not found`
                result.missingItems.push(config.expectedOutput)
                this.state.lastEvaluation = result
                this.emit("eval", `Evaluation: FAIL — ${result.feedback}`)
                this.saveState()
                return result
            }

            // Read the file content
            const content = fs.readFileSync(filePath, "utf-8")

            // Try LLM-as-Judge first if requested (Phase 5a)
            if (useLLM) {
                try {
                    const llmResult = await this.evaluateWithLLM(content, config)
                    if (llmResult) {
                        Object.assign(result, llmResult)
                        this.state.lastEvaluation = result
                        this.emit("eval", `LLM Evaluation: ${result.pass ? "PASS" : "FAIL"} (${result.score}/100) — ${result.feedback}`)
                        this.saveState()
                        return result
                    }
                } catch (err) {
                    this.emit("error", `LLM evaluation failed, falling back to keyword-based: ${err}`)
                }
            }

            // Fallback: keyword-based evaluation
            let score = 0
            const missing: string[] = []

            if (content.length < 50) {
                missing.push("File content too short (< 50 chars)")
            } else {
                score += 25
            }

            // Check each criterion
            for (const criterion of config.evaluationCriteria) {
                // Simple keyword-based check
                const keywords = criterion.toLowerCase().split(" ")
                const contentLower = content.toLowerCase()
                const found = keywords.some((kw) => kw.length > 3 && contentLower.includes(kw))
                if (found) {
                    score += Math.floor(75 / config.evaluationCriteria.length)
                } else {
                    missing.push(criterion)
                }
            }

            result.score = Math.min(score, 100)
            result.pass = result.score >= 60
            result.missingItems = missing
            result.feedback = result.pass
                ? `Phase ${this.state.phase} output looks good (score: ${result.score}/100)`
                : `Phase ${this.state.phase} needs improvement (score: ${result.score}/100). Missing: ${missing.join(", ")}`
        } else {
            // No expected output (like ARCHIVE) — auto-pass
            result.pass = true
            result.score = 100
            result.feedback = "Phase auto-approved (no output required)"
        }

        this.state.lastEvaluation = result
        this.emit("eval", `Evaluation: ${result.pass ? "PASS" : "FAIL"} (${result.score}/100)`)
        this.saveState()
        return result
    }

    /**
     * LLM-as-Judge evaluation (Phase 5a).
     * Sends the phase output to the AI model with a structured rubric.
     * Returns null if the AI is unavailable, allowing fallback to keyword-based.
     */
    private async evaluateWithLLM(
        content: string,
        config: PhaseConfig
    ): Promise<Partial<EvaluationResult> | null> {
        // Build the evaluation prompt with a structured rubric
        const rubric = config.evaluationCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")
        const evaluationPrompt = `You are an expert code reviewer and project evaluator. Evaluate the following ${this.state.phase} output against the rubric below.

## Rubric
${rubric}

## Content to Evaluate
\`\`\`
${content.substring(0, 4000)}
\`\`\`

## Response Format (JSON only)
Respond with ONLY a valid JSON object, no other text:
{
  "score": <number 0-100>,
  "pass": <boolean, true if score >= 70>,
  "feedback": "<1-2 sentence summary>",
  "missingItems": ["<item1>", "<item2>"]
}
`

        // Try to send through the provider's createTask
        if (this.provider.postMessageToWebview) {
            // We can't easily get a synchronous response from the AI in-extension,
            // so we write the evaluation request to a file and let the Bridge handle it
            const evalRequestPath = this.getActivePath("_EVAL_REQUEST.json")
            const evalResponsePath = this.getActivePath("_EVAL_RESPONSE.json")

            // Clean up any previous evaluation
            if (fs.existsSync(evalResponsePath)) {
                fs.unlinkSync(evalResponsePath)
            }

            // Write the evaluation request
            fs.writeFileSync(evalRequestPath, JSON.stringify({
                prompt: evaluationPrompt,
                phase: this.state.phase,
                timestamp: new Date().toISOString(),
            }, null, 2), "utf-8")

            // Send the evaluation prompt to the agent
            try {
                await this.provider.postMessageToWebview({
                    type: "invoke",
                    invoke: "sendMessage",
                    text: evaluationPrompt,
                })
            } catch {
                // If webview is not available, try createTask
                if (this.provider.createTask) {
                    await this.provider.createTask(evaluationPrompt)
                }
            }

            // Wait for the response (poll for up to 60 seconds)
            const maxWait = 60000
            const pollInterval = 2000
            let waited = 0

            while (waited < maxWait) {
                await new Promise((resolve) => setTimeout(resolve, pollInterval))
                waited += pollInterval

                if (fs.existsSync(evalResponsePath)) {
                    try {
                        const raw = fs.readFileSync(evalResponsePath, "utf-8")
                        const parsed = JSON.parse(raw)
                        // Clean up temp files
                        try { fs.unlinkSync(evalRequestPath) } catch {}
                        try { fs.unlinkSync(evalResponsePath) } catch {}
                        return {
                            score: Math.min(100, Math.max(0, parsed.score || 0)),
                            pass: !!parsed.pass,
                            feedback: parsed.feedback || "LLM evaluation complete",
                            missingItems: parsed.missingItems || [],
                        }
                    } catch {
                        // Invalid JSON in response, continue waiting
                    }
                }
            }

            // Timeout — clean up and return null to fall back
            try { fs.unlinkSync(evalRequestPath) } catch {}
            this.emit("error", "LLM evaluation timed out after 60s")
            return null
        }

        return null
    }

    /** Generate a context-aware prompt for current phase */
    async generatePrompt(isRetry: boolean = false): Promise<string> {
        const config = PHASE_CONFIG[this.state.phase]
        let prompt = config.promptTemplate

        // Add feature request context
        if (this.state.featureRequest) {
            prompt = `## Feature Request\n${this.state.featureRequest}\n\n## Your Task\n${prompt}`
        }

        // Add detected stack context (UNIVERSAL)
        if (this.state.detectedStack) {
            const s = this.state.detectedStack
            const stackLines: string[] = [
                `\n\n## Detected Project Stack (auto-detected — follow these conventions)`,
                `- **Languages:** ${s.languages.join(", ") || "N/A"}`,
                `- **Frameworks:** ${s.frameworks.map(f => `${f.name} (${f.category})`).join(", ") || "N/A"}`,
                `- **Databases:** ${s.databases.join(", ") || "N/A"}`,
                `- **Architecture:** ${s.architecture}`,
                `- **Platforms:** ${s.platforms.join(", ")}`,
                `- **Package Managers:** ${s.packageManagers.join(", ") || "N/A"}`,
                `- **Build Tools:** ${s.buildTools.join(", ") || "N/A"}`,
            ]
            if (s.styling.length) stackLines.push(`- **Styling:** ${s.styling.join(", ")}`)
            if (s.stateManagement.length) stackLines.push(`- **State Management:** ${s.stateManagement.join(", ")}`)
            if (s.orm.length) stackLines.push(`- **ORM:** ${s.orm.join(", ")}`)
            if (s.testing.length) stackLines.push(`- **Testing:** ${s.testing.join(", ")}`)
            if (s.devops.length) stackLines.push(`- **DevOps:** ${s.devops.join(", ")}`)
            stackLines.push(`\n**IMPORTANT:** All code, architecture decisions, and file paths must follow the conventions of the detected stack above. Do NOT mix patterns from other stacks.`)
            prompt += stackLines.join("\n")
        }

        // Add lessons learned context
        try {
            const lessonsPath = this.getWorkflowPath("LESSONS_LEARNED.md")
            if (fs.existsSync(lessonsPath)) {
                const lessons = fs.readFileSync(lessonsPath, "utf-8")
                if (lessons.length > 10) {
                    prompt += `\n\n## Past Lessons (avoid these mistakes)\n${lessons.substring(0, 500)}`
                }
            }
        } catch {}

        // Add PHASE_DNA context
        try {
            const dnaPath = this.getWorkflowPath("PHASE_DNA.md")
            if (fs.existsSync(dnaPath)) {
                const dna = fs.readFileSync(dnaPath, "utf-8")
                if (dna.length > 10) {
                    prompt += `\n\n## Project DNA\n${dna.substring(0, 500)}`
                }
            }
        } catch {}

        // Add retry context
        if (isRetry && this.state.lastEvaluation) {
            prompt += `\n\n## RETRY — Previous Attempt Failed\nFeedback: ${this.state.lastEvaluation.feedback}\nMissing: ${this.state.lastEvaluation.missingItems.join(", ")}\nPlease address these issues in this attempt.`
        }

        this.state.lastPrompt = prompt
        return prompt
    }

    /** Re-scan the workspace to update detected stack */
    rescanStack(): DetectedStack {
        this.state.detectedStack = this.stackDetector.detect()
        this.emit("info", `Stack re-scanned: ${this.state.detectedStack.summary}`)
        this.saveState()
        return this.state.detectedStack
    }

    /** Get detected stack */
    getStack(): DetectedStack | null {
        return this.state.detectedStack
    }

    /** Set autonomy level */
    setAutonomy(level: AutonomyLevel): void {
        this.state.autonomy = level
        this.emit("info", `Autonomy set to ${level.toUpperCase()}`)
        if (level === "full-auto" && this.state.isRunning) {
            this.startAutopilotLoop()
        } else {
            this.stopAutopilotLoop()
        }
        this.saveState()
    }

    /** Abort the current cycle */
    abort(): void {
        this.state.isRunning = false
        this.state.isPaused = false
        this.state.error = "Aborted by user"
        this.stopAutopilotLoop()
        this.emit("info", "Cycle aborted by user")
        this.saveState()
    }

    /** Reset to INIT */
    reset(): void {
        this.state.phase = "INIT"
        this.state.previousPhase = null
        this.state.isRunning = false
        this.state.isPaused = false
        this.state.transitionCount = 0
        this.state.retryCount = 0
        this.state.error = null
        this.state.lastEvaluation = null
        this.state.featureRequest = ""
        this.state.eventLog = []
        this.stopAutopilotLoop()
        this.emit("info", "Engine reset to INIT")
        this.saveState()
    }

    // ========================================================================
    // AUTOPILOT
    // ========================================================================

    private startAutopilotLoop(): void {
        this.stopAutopilotLoop()
        this.emit("info", "Autopilot loop started.")

        // Watch for expected output files
        this.fileWatchInterval = setInterval(async () => {
            if (!this.state.isRunning || this.state.isPaused || this.state.phase === "COMPLETE") {
                return
            }

            const config = PHASE_CONFIG[this.state.phase]
            if (!config.expectedOutput) {
                // Auto-advance phases with no expected output (ARCHIVE)
                await this.advancePhase()
                return
            }

            // Check if the expected output was created
            const filePath = this.getActivePath(config.expectedOutput)
            if (fs.existsSync(filePath)) {
                const stat = fs.statSync(filePath)
                const ageMs = Date.now() - stat.mtimeMs
                // File must be at least 5 seconds old (agent finished writing)
                if (ageMs > 5000) {
                    this.emit("file", `Detected: ${config.expectedOutput}`)
                    const evaluation = await this.evaluatePhase()
                    if (evaluation.pass) {
                        await this.advancePhase()
                    } else if (this.state.retryCount < this.state.maxRetries) {
                        await this.retryPhase()
                    } else {
                        this.state.isPaused = true
                        this.emit("error", "Autopilot paused — max retries reached")
                        this.saveState()
                    }
                }
            }
        }, 10000) // Check every 10 seconds
    }

    private stopAutopilotLoop(): void {
        if (this.fileWatchInterval) {
            clearInterval(this.fileWatchInterval)
            this.fileWatchInterval = null
        }
        if (this.autopilotTimer) {
            clearTimeout(this.autopilotTimer)
            this.autopilotTimer = null
        }
    }

    // ========================================================================
    // ARCHIVE
    // ========================================================================

    private archiveActiveFiles(): void {
        const activeDir = path.join(this.workspaceRoot, "WORKFLOW", "ACTIVE")
        const historyDir = path.join(this.workspaceRoot, "WORKFLOW", "HISTORY")
        if (!fs.existsSync(activeDir)) return
        if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true })

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
        const archiveDir = path.join(historyDir, `cycle-${timestamp}`)
        fs.mkdirSync(archiveDir, { recursive: true })

        try {
            const files = fs.readdirSync(activeDir)
            for (const file of files) {
                fs.copyFileSync(path.join(activeDir, file), path.join(archiveDir, file))
            }
            this.emit("file", `Archived ${files.length} files to HISTORY/cycle-${timestamp}`)
        } catch (err) {
            this.emit("error", `Archive failed: ${err}`)
        }
    }

    // ========================================================================
    // CLEANUP
    // ========================================================================

    dispose(): void {
        this.stopAutopilotLoop()
        this.listeners = []
    }
}
