import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"

/**
 * GateValidator
 *
 * Provides in-editor quality gate validation. Reads the current workflow state
 * from ORCHESTRATION_STATUS.json and validates the expected output file against
 * the same quality gate rules used by orchestrator.ps1.
 *
 * VS Code command: roo-code.checkWorkflowGate
 */
export class GateValidator {
    /**
     * Read testingMode from WORKFLOW/workflow-config.json. Falls back to
     * "post-hoc" when missing/corrupt. Keep in sync with the PS-side
     * Get-WorkflowConfig in orchestrator.ps1.
     */
    private getTestingMode(workspaceRoot: string): "tdd" | "post-hoc" | "none" {
        try {
            const p = path.join(workspaceRoot, "WORKFLOW", "workflow-config.json")
            if (!fs.existsSync(p)) return "post-hoc"
            const cfg = JSON.parse(fs.readFileSync(p, "utf8"))
            const mode = cfg.testingMode
            if (mode === "tdd" || mode === "post-hoc" || mode === "none") return mode
        } catch { /* ignore — fall through to default */ }
        return "post-hoc"
    }

    /**
     * Gate 4 validation — execution report must have Files Modified/Created/Changed
     * AND Tests Run (unless testingMode=none, in which case the skip marker is
     * accepted). Mirror of Test-ExecutionReportGate in orchestrator.ps1.
     */
    private validateExecutionReport(content: string, testingMode: "tdd" | "post-hoc" | "none"): { passed: boolean; reason?: string } {
        const missing: string[] = []
        if (!/(?:^|\n)##\s+Files (Modified|Created|Changed)\b/.test(content)) {
            missing.push("Files Modified|Created|Changed")
        }
        const hasTestsHeader = /(?:^|\n)##\s+Tests Run\b/.test(content)
        const hasSkipMarker = /_Skipped:\s*testingMode=none_/.test(content)
        if (testingMode === "none") {
            if (!hasTestsHeader && !hasSkipMarker) missing.push("Tests Run (or _Skipped: testingMode=none_ marker)")
        } else if (!hasTestsHeader) {
            missing.push("Tests Run")
        }
        return missing.length === 0
            ? { passed: true }
            : { passed: false, reason: `Missing required sections: ${missing.join(", ")}` }
    }

    private readonly GATE_RULES: Record<string, {
        gateNumber: number
        gateName: string
        expectedFile: string
        validate: (content: string, workspaceRoot?: string, self?: GateValidator) => { passed: boolean; reason?: string }
    }> = {
        "PHASE_PLANNING": {
            gateNumber: 1,
            gateName: "Phase Plan Valid",
            expectedFile: "PHASE_PLAN.md",
            validate: (content: string) => {
                const hasPhaseHeader = /## Phase \d/.test(content)
                return {
                    passed: hasPhaseHeader,
                    reason: hasPhaseHeader ? undefined : 'Must contain at least one "## Phase N:" section header'
                }
            }
        },
        "DETAILED_PLANNING": {
            gateNumber: 2,
            gateName: "Detailed Plan Valid",
            expectedFile: "DETAILED_PLAN.md",
            validate: (content: string) => {
                const hasSections = /## (Files to Modify|Implementation Steps)/.test(content)
                return {
                    passed: hasSections,
                    reason: hasSections ? undefined : 'Must contain "## Files to Modify" or "## Implementation Steps" sections'
                }
            }
        },
        "PLAN_REVIEW": {
            gateNumber: 3,
            gateName: "Plan Review Valid",
            expectedFile: "PLAN_REVIEW.md",
            validate: (content: string) => {
                const missing: string[] = []
                if (!/STATUS:\s*(APPROVED|NEEDS_REVISION)/.test(content)) missing.push('STATUS: APPROVED|NEEDS_REVISION')
                if (!/RATING:\s*(10|[1-9])\s*\/\s*10\b/.test(content))   missing.push('RATING: N/10')
                if (!/RATING_REASONING:\s*\S+/m.test(content))            missing.push('RATING_REASONING: <text>')
                return {
                    passed: missing.length === 0,
                    reason: missing.length === 0 ? undefined : `Missing required fields: ${missing.join(', ')}`
                }
            }
        },
        "EXECUTION": {
            gateNumber: 4,
            gateName: "Execution Report Valid",
            expectedFile: "EXECUTION_REPORT.md",
            validate: (content: string, workspaceRoot?: string, self?: GateValidator) => {
                const mode = self && workspaceRoot ? self.getTestingMode(workspaceRoot) : "post-hoc"
                return self ? self.validateExecutionReport(content, mode) : { passed: true }
            }
        },
        "EXECUTION_REVIEW": {
            gateNumber: 5,
            gateName: "Execution Review Valid",
            expectedFile: "EXECUTION_REVIEW.md",
            validate: (content: string) => {
                const missing: string[] = []
                if (!/STATUS:\s*(APPROVED|NEEDS_REVISION)/.test(content)) missing.push('STATUS: APPROVED|NEEDS_REVISION')
                if (!/RATING:\s*(10|[1-9])\s*\/\s*10\b/.test(content))   missing.push('RATING: N/10')
                if (!/RATING_REASONING:\s*\S+/m.test(content))            missing.push('RATING_REASONING: <text>')
                return {
                    passed: missing.length === 0,
                    reason: missing.length === 0 ? undefined : `Missing required fields: ${missing.join(', ')}`
                }
            }
        },
        "EXECUTION_BACKEND": {
            gateNumber: 4,
            gateName: "Backend Execution Report Valid",
            expectedFile: "EXECUTION_REPORT_BACKEND.md",
            validate: (content: string, workspaceRoot?: string, self?: GateValidator) => {
                const mode = self && workspaceRoot ? self.getTestingMode(workspaceRoot) : "post-hoc"
                return self ? self.validateExecutionReport(content, mode) : { passed: true }
            }
        },
        "EXECUTION_FRONTEND": {
            gateNumber: 4,
            gateName: "Frontend Execution Report Valid",
            expectedFile: "EXECUTION_REPORT_FRONTEND.md",
            validate: (content: string, workspaceRoot?: string, self?: GateValidator) => {
                const mode = self && workspaceRoot ? self.getTestingMode(workspaceRoot) : "post-hoc"
                return self ? self.validateExecutionReport(content, mode) : { passed: true }
            }
        }
    }

    validate(workspaceRoot: string): {
        state: string
        gateNumber: number
        gateName: string
        passed: boolean
        reason?: string
        expectedFile: string
        fileExists: boolean
    } | null {
        const statusFile = path.join(workspaceRoot, "WORKFLOW", "ORCHESTRATION_STATUS.json")
        if (!fs.existsSync(statusFile)) return null

        let status: any
        try {
            status = JSON.parse(fs.readFileSync(statusFile, "utf8"))
        } catch { return null }

        const currentState = status.currentState
        const rule = this.GATE_RULES[currentState]
        if (!rule) return null

        const activeDir = path.join(workspaceRoot, "WORKFLOW", "ACTIVE")
        const expectedFilePath = path.join(activeDir, rule.expectedFile)
        const fileExists = fs.existsSync(expectedFilePath)

        if (!fileExists) {
            return {
                state: currentState,
                gateNumber: rule.gateNumber,
                gateName: rule.gateName,
                passed: false,
                reason: `Expected file not found: WORKFLOW/ACTIVE/${rule.expectedFile}`,
                expectedFile: rule.expectedFile,
                fileExists: false
            }
        }

        const content = fs.readFileSync(expectedFilePath, "utf8")
        const result = rule.validate(content, workspaceRoot, this)

        return {
            state: currentState,
            gateNumber: rule.gateNumber,
            gateName: rule.gateName,
            passed: result.passed,
            reason: result.reason,
            expectedFile: rule.expectedFile,
            fileExists: true
        }
    }

    registerCommands(context: vscode.ExtensionContext, workspaceRoot: string) {
        const disposable = vscode.commands.registerCommand(
            "roo-code.checkWorkflowGate",
            async () => {
                const result = this.validate(workspaceRoot)

                if (!result) {
                    vscode.window.showInformationMessage(
                        "No quality gate applicable for the current workflow state (INIT, ARCHIVE, or COMPLETE)."
                    )
                    return
                }

                if (result.passed) {
                    vscode.window.showInformationMessage(
                        `✅ Gate ${result.gateNumber} (${result.gateName}) passed! Run orchestrator.ps1 -Next to proceed.`
                    )
                } else {
                    const panel = vscode.window.createWebviewPanel(
                        "workflowGate",
                        `Gate ${result.gateNumber} — ${result.state}`,
                        vscode.ViewColumn.Beside,
                        { enableScripts: false }
                    )
                    panel.webview.html = this.renderGateFailureHTML(result)
                }
            }
        )
        context.subscriptions.push(disposable)
    }

    private renderGateFailureHTML(result: {
        gateNumber: number
        gateName: string
        reason?: string
        expectedFile: string
        fileExists: boolean
    }): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; background: #1e1e1e; color: #d4d4d4; }
        h2 { color: #f44747; margin-top: 0; }
        .gate-header { background: #2d2d2d; border-left: 4px solid #f44747; padding: 12px 16px; border-radius: 4px; margin-bottom: 16px; }
        .gate-header h3 { margin: 0 0 4px 0; color: #f44747; }
        .gate-header p { margin: 0; color: #969696; }
        .detail { margin-bottom: 12px; }
        .detail-label { color: #969696; font-size: 12px; text-transform: uppercase; margin-bottom: 4px; }
        .detail-value { background: #252526; padding: 8px 12px; border-radius: 4px; font-family: 'Consolas', 'Courier New', monospace; font-size: 13px; }
        .fix-suggestion { background: #1e3a2f; border: 1px solid #2d6b4f; padding: 12px 16px; border-radius: 4px; margin-top: 20px; }
        .fix-suggestion h4 { margin: 0 0 8px 0; color: #4ec9b0; }
        code { background: #3c3c3c; padding: 1px 4px; border-radius: 3px; }
    </style>
</head>
<body>
    <h2>❌ Quality Gate ${result.gateNumber} Failed</h2>
    <div class="gate-header">
        <h3>${result.gateName}</h3>
        <p>${result.reason || "Unknown validation error"}</p>
    </div>
    <div class="detail">
        <div class="detail-label">Expected File</div>
        <div class="detail-value">WORKFLOW/ACTIVE/${result.expectedFile}</div>
    </div>
    <div class="detail">
        <div class="detail-label">File Status</div>
        <div class="detail-value">${result.fileExists ? "✅ File exists" : "❌ File not found"}</div>
    </div>
    <div class="fix-suggestion">
        <h4>🛠 Suggested Fix</h4>
        <p>${result.fileExists
            ? `Open <code>WORKFLOW/ACTIVE/${result.expectedFile}</code> and ensure it meets the gate requirements shown above.`
            : `Create <code>WORKFLOW/ACTIVE/${result.expectedFile}</code> with the required content before running orchestrator.ps1 -Next.`}
        </p>
        <p style="margin-top: 8px; color: #969696;">After fixing, run <code>orchestrator.ps1 -Next</code> in the terminal to retry.</p>
    </div>
</body>
</html>`
    }
}
