import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"

/**
 * WorkflowWatcher
 *
 * Watches ORCHESTRATION_STATUS.json for state changes and automatically
 * switches the Roo Code mode to match the current workflow phase.
 *
 * State → Mode mapping:
 *   PHASE_PLANNING, PLAN_REVIEW, EXECUTION_REVIEW, ARCHIVE → director
 *   DETAILED_PLANNING → planner
 *   EXECUTION, EXECUTION_BACKEND, EXECUTION_FRONTEND → executor
 *
 * Features:
 *   - Configurable debounce interval
 *   - Retry logic with exponential backoff for JSON parse failures
 */
export class WorkflowWatcher {
    private watcher: fs.FSWatcher | undefined
    private debounceTimer: NodeJS.Timeout | undefined
    private lastState: string = ""

    private readonly STATE_MODE_MAP: Record<string, string> = {
        "PHASE_PLANNING":     "director",
        "PLAN_REVIEW":        "director",
        "EXECUTION_REVIEW":   "director",
        "ARCHIVE":            "director",
        "DETAILED_PLANNING":  "planner",
        "EXECUTION":          "executor",
        "EXECUTION_BACKEND":  "executor",
        "EXECUTION_FRONTEND": "executor",
    }

    private readonly MAX_RETRIES = 3
    private readonly RETRY_BASE_MS = 200

    activate(
        workspacePath: string,
        switchModeFn: (slug: string) => void,
        debounceMs: number = 500
    ) {
        const statusFile = path.join(workspacePath, "WORKFLOW", "ORCHESTRATION_STATUS.json")
        if (!fs.existsSync(statusFile)) {
            console.log("[WorkflowWatcher] No ORCHESTRATION_STATUS.json found — workflow integration disabled.")
            return
        }

        try {
            const initial = JSON.parse(fs.readFileSync(statusFile, "utf8"))
            this.lastState = initial.currentState || ""
        } catch { /* ignore initial read failure */ }

        this.watcher = fs.watch(statusFile, (eventType) => {
            if (eventType !== "change") return

            if (this.debounceTimer) clearTimeout(this.debounceTimer)
            this.debounceTimer = setTimeout(() => {
                this.readWithRetry(statusFile, 0, switchModeFn)
            }, debounceMs)
        })

        console.log(`[WorkflowWatcher] Activated — watching ${statusFile} (debounce: ${debounceMs}ms)`)
    }

    /**
     * Read and parse the status file with retry logic.
     * Uses exponential backoff (200ms, 400ms, 800ms) for concurrent write scenarios.
     */
    private readWithRetry(
        statusFile: string,
        attempt: number,
        switchModeFn: (slug: string) => void
    ) {
        try {
            const status = JSON.parse(fs.readFileSync(statusFile, "utf8"))
            const newState = status.currentState

            if (newState && newState !== this.lastState) {
                this.lastState = newState
                const targetMode = this.STATE_MODE_MAP[newState]

                if (targetMode) {
                    switchModeFn(targetMode)
                    this.writeCurrentModeSidecar(statusFile, targetMode)
                    vscode.window.showInformationMessage(
                        `🤖 Workflow: ${newState} → Switched to ${targetMode.toUpperCase()} mode`
                    )
                } else if (newState === "COMPLETE") {
                    this.writeCurrentModeSidecar(statusFile, "")
                    vscode.window.showInformationMessage("✅ Workflow complete! All files archived.")
                } else if (newState === "INIT") {
                    this.writeCurrentModeSidecar(statusFile, "")
                    vscode.window.showInformationMessage("🔄 Workflow reset to INIT. Provide a feature request to begin.")
                }
            }
        } catch {
            if (attempt < this.MAX_RETRIES) {
                const delay = this.RETRY_BASE_MS * Math.pow(2, attempt)
                console.warn(`[WorkflowWatcher] JSON parse failed (attempt ${attempt + 1}/${this.MAX_RETRIES}), retrying in ${delay}ms`)
                setTimeout(() => this.readWithRetry(statusFile, attempt + 1, switchModeFn), delay)
            } else {
                console.error("[WorkflowWatcher] Failed to parse status file after max retries — skipping this change event.")
            }
        }
    }

    /**
     * Write WORKFLOW/CURRENT_MODE.json so the dashboard can show what mode the
     * editor is currently in. Sidecar-style (separate file) — never mutates
     * ORCHESTRATION_STATUS.json to avoid concurrent-write races with the
     * orchestrator. Stale sidecars (>30s old) are ignored by the dashboard.
     */
    private writeCurrentModeSidecar(statusFile: string, mode: string) {
        try {
            const workflowDir = path.dirname(statusFile)
            const sidecarPath = path.join(workflowDir, "CURRENT_MODE.json")
            const payload = JSON.stringify({ mode, updatedAt: new Date().toISOString() })
            const tmpPath = sidecarPath + ".tmp"
            fs.writeFileSync(tmpPath, payload, "utf8")
            fs.renameSync(tmpPath, sidecarPath)
        } catch (err) {
            console.warn("[WorkflowWatcher] Could not write CURRENT_MODE.json:", err)
        }
    }

    dispose() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer)
        this.watcher?.close()
    }
}
