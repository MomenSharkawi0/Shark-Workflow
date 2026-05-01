import * as vscode from "vscode"

/**
 * WorkflowStatusBar
 *
 * Persistent VS Code status bar item showing current workflow phase, state,
 * retry count, and autopilot status. Turns red when workflow is BLOCKED.
 *
 * Features:
 *   - Phase name in status text
 *   - Cycle elapsed time in tooltip
 *   - Configurable polling interval
 */
export class WorkflowStatusBar {
    private item: vscode.StatusBarItem
    private resumeItem: vscode.StatusBarItem
    private updateTimer: NodeJS.Timeout | undefined

    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
        this.item.command = "roo-code.showWorkflowStatus"
        this.item.tooltip = "Click to open workflow status"

        // Always-visible Resume button — fallback if the watcher's auto-trigger
        // misses (e.g. agent thread closed). Cheap to leave on; clicking is a
        // no-op when the agent is mid-work because the resume prompt arrives
        // as a follow-up message rather than starting a new task.
        this.resumeItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99)
        this.resumeItem.command = "roo-code.resumeWorkflow"
        this.resumeItem.tooltip = "Resend the 'read CURRENT_INSTRUCTION.md and proceed' trigger to the active agent"
        this.resumeItem.text = "$(play) Resume Workflow"
    }

    update(status: {
        currentState: string
        phase: string
        retryCount: number
        autopilot: boolean
        status: string
        cycleStart?: string
    }) {
        const icon = status.autopilot ? "✈️" : "🔵"
        const retry = status.retryCount > 0 ? ` ↺${status.retryCount}` : ""
        const stateLabel = status.currentState.replace(/_/g, " ")
        const phaseLabel = status.phase ? ` — ${status.phase}` : ""

        this.item.text = `${icon} ${stateLabel}${retry}${phaseLabel}`
        this.item.tooltip = [
            `Phase: ${status.phase || "None"}`,
            `State: ${status.currentState}`,
            `Autopilot: ${status.autopilot ? "ON" : "OFF"}`,
            `Status: ${status.status}`,
            status.cycleStart ? `Elapsed: ${this.getElapsed(status.cycleStart)}` : "",
            "Click to open workflow status",
        ].filter(Boolean).join("\n")

        if (status.status === "BLOCKED") {
            this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground")
            this.item.color = new vscode.ThemeColor("statusBarItem.errorForeground")
        } else if (status.status === "COMPLETE") {
            this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.prominentBackground")
            this.item.color = undefined
        } else {
            this.item.backgroundColor = undefined
            this.item.color = undefined
        }

        this.item.show()

        // Show Resume nudge while the workflow is active; hide on terminal states.
        if (status.status === "COMPLETE" || status.currentState === "INIT") {
            this.resumeItem.hide()
        } else {
            this.resumeItem.show()
        }
    }

    private getElapsed(cycleStart: string): string {
        try {
            const ms = Date.now() - new Date(cycleStart).getTime()
            const mins = Math.floor(ms / 60000)
            const hrs = Math.floor(mins / 60)
            if (hrs > 0) return `${hrs}h ${mins % 60}m`
            return `${mins}m`
        } catch {
            return "—"
        }
    }

    startPolling(
        readStatusFn: () => {
            currentState: string
            phase: string
            retryCount: number
            autopilot: boolean
            status: string
            cycleStart?: string
        } | null,
        intervalMs = 3000
    ) {
        const initial = readStatusFn()
        if (initial) this.update(initial)

        this.updateTimer = setInterval(() => {
            const data = readStatusFn()
            if (data) this.update(data)
        }, intervalMs)
    }

    dispose() {
        if (this.updateTimer) clearInterval(this.updateTimer)
        this.item.hide()
        this.item.dispose()
        this.resumeItem.hide()
        this.resumeItem.dispose()
    }
}
