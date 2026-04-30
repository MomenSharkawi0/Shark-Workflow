/**
 * Roo Code Workflow Integration — Single Entry Point
 *
 * This is the ONLY file that needs to be imported from src/extension.ts.
 * All workflow-related functionality is encapsulated here to minimize
 * merge conflicts when syncing with upstream Roo Code changes.
 *
 * Integration in extension.ts:
 *
 *   import { activateWorkflowIntegration } from "./workflow"
 *   // ... inside activate() ...
 *   activateWorkflowIntegration(context, provider)
 */

import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"
import { WorkflowWatcher } from "./WorkflowWatcher"
import { WorkflowStatusBar } from "./WorkflowStatusBar"
import { ContextInjector } from "./ContextInjector"
import { GateValidator } from "./GateValidator"
import { WorkflowBridge } from "./WorkflowBridge"
import { WorkflowDashboardPanel } from "./DashboardPanel"

export interface ClineProviderLike {
    setMode?(slug: string): void | Promise<void>
    getMode?(): Promise<string>
    getModes?(): Promise<{ slug: string; name: string }[]>
    getCurrentMode?(): string
    getSystemPrompt?(): string
    setSystemPrompt?(prompt: string): void
    createTask?(text?: string, images?: string[]): Promise<any>
    cancelTask?(): Promise<void>
    clearTask?(): Promise<void>
    getCurrentTask?(): any
    postMessageToWebview?(message: any): Promise<void>
}

/**
 * Configuration interface for the workflow integration.
 * All values are optional — sensible defaults are used when not provided.
 * Can be overridden via WORKFLOW/workflow-config.json in the workspace.
 */
export interface WorkflowConfig {
    /** Per-mode token budget limits */
    tokenBudgets: Record<string, number>
    /** Debounce interval (ms) for the file watcher */
    debounceMs: number
    /** Status bar polling interval (ms) */
    pollingIntervalMs: number
    /** Max file size (KB) for context injection — larger files are truncated */
    maxContextFileSizeKb: number
    /** Gate strictness: "hard" blocks transitions, "soft" warns only */
    gateStrictness: "hard" | "soft"
    /** Per-mode context files to auto-inject */
    contextFiles: Record<string, string[]>
}

/** Default configuration values */
const DEFAULT_CONFIG: WorkflowConfig = {
    tokenBudgets: {
        "director": 4_000,
        "planner": 8_000,
        "executor": 32_000,
        "workflow-master": 32_000,
    },
    debounceMs: 500,
    pollingIntervalMs: 3000,
    maxContextFileSizeKb: 50,
    gateStrictness: "hard",
    contextFiles: {
        "director": [
            "WORKFLOW/ORCHESTRATION_STATUS.json",
            "WORKFLOW/LESSONS_LEARNED.md",
            "WORKFLOW/PHASE_DNA.md",
            "WORKFLOW/GOLDEN_RULES.md",
            "WORKFLOW/SELF_REVIEW_CHECKLIST.md",
        ],
        "planner": [
            "WORKFLOW/ORCHESTRATION_STATUS.json",
            "WORKFLOW/ACTIVE/PHASE_PLAN.md",
            "WORKFLOW/LESSONS_LEARNED.md",
            "WORKFLOW/PHASE_DNA.md",
            "WORKFLOW/GOLDEN_RULES.md",
            "WORKFLOW/ACTIVE/QUALITY_GATES.md",
        ],
        "executor": [
            "WORKFLOW/ORCHESTRATION_STATUS.json",
            "WORKFLOW/ACTIVE/PLAN_APPROVED.md",
            "WORKFLOW/LESSONS_LEARNED.md",
        ],
        "workflow-master": [
            "WORKFLOW/ORCHESTRATION_STATUS.json",
            "WORKFLOW/LESSONS_LEARNED.md",
            "WORKFLOW/PHASE_DNA.md",
            "WORKFLOW/GOLDEN_RULES.md",
            "WORKFLOW/SELF_REVIEW_CHECKLIST.md",
            "WORKFLOW/ACTIVE/QUALITY_GATES.md",
        ],
    },
}

/** Cached config instance — loaded once per activation */
let _activeConfig: WorkflowConfig = { ...DEFAULT_CONFIG }

/**
 * Load workflow config from WORKFLOW/workflow-config.json if it exists.
 * Merges user overrides with defaults so partial configs are supported.
 */
function loadConfig(workspaceRoot: string): WorkflowConfig {
    const configPath = path.join(workspaceRoot, "WORKFLOW", "workflow-config.json")
    if (!fs.existsSync(configPath)) {
        return { ...DEFAULT_CONFIG }
    }

    try {
        const raw = fs.readFileSync(configPath, "utf8")
        const userConfig = JSON.parse(raw)
        return {
            tokenBudgets: { ...DEFAULT_CONFIG.tokenBudgets, ...(userConfig.tokenBudgets || {}) },
            debounceMs: userConfig.debounceMs ?? DEFAULT_CONFIG.debounceMs,
            pollingIntervalMs: userConfig.pollingIntervalMs ?? DEFAULT_CONFIG.pollingIntervalMs,
            maxContextFileSizeKb: userConfig.maxContextFileSizeKb ?? DEFAULT_CONFIG.maxContextFileSizeKb,
            gateStrictness: userConfig.gateStrictness ?? DEFAULT_CONFIG.gateStrictness,
            contextFiles: { ...DEFAULT_CONFIG.contextFiles, ...(userConfig.contextFiles || {}) },
        }
    } catch (err) {
        console.warn("[Workflow] Could not parse workflow-config.json, using defaults:", err)
        return { ...DEFAULT_CONFIG }
    }
}

/**
 * Get the active workflow configuration.
 * Returns the cached config loaded during activation.
 */
export function getWorkflowConfig(): WorkflowConfig {
    return _activeConfig
}

/**
 * Activate the complete workflow integration.
 * Called once during extension activation.
 */
export function activateWorkflowIntegration(
    context: vscode.ExtensionContext,
    provider: ClineProviderLike
): void {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath
    if (!workspaceRoot) {
        console.log("[Workflow] No workspace folder open — skipping workflow integration.")
        return
    }

    // 1. HTTP Bridge for Dashboard → Roo Code control
    // Always start the bridge so Dashboard can connect, even before workflow is initialized
    const bridge = new WorkflowBridge(provider, 3001)
    bridge.start()
    bridge.initEngine(workspaceRoot)  // Initialize the AI Workflow Engine
    context.subscriptions.push({ dispose: () => bridge.dispose() })
    console.log("[Workflow] Bridge + Engine activated on port 3001")

    const statusFilePath = path.join(workspaceRoot, "WORKFLOW", "ORCHESTRATION_STATUS.json")
    if (!fs.existsSync(statusFilePath)) {
        console.log("[Workflow] No WORKFLOW/ORCHESTRATION_STATUS.json — skipping workflow watcher & status bar.")
        return
    }

    // Load configuration (merges user overrides with defaults)
    _activeConfig = loadConfig(workspaceRoot)
    console.log(`[Workflow] Config loaded — debounce: ${_activeConfig.debounceMs}ms, polling: ${_activeConfig.pollingIntervalMs}ms, gate: ${_activeConfig.gateStrictness}`)

    // 1. Auto Mode-Switch Watcher
    const watcher = new WorkflowWatcher()
    watcher.activate(workspaceRoot, (slug) => {
        // Expose current mode for token budget resolution in the API layer
        ;(globalThis as any).__rooWorkflowMode = slug

        if (provider.setMode) {
            provider.setMode(slug)
        }

        // Also inject context after mode switch
        const injector = new ContextInjector(_activeConfig.contextFiles, _activeConfig.maxContextFileSizeKb)
        const contextBlock = injector.getInjectedContext(slug, workspaceRoot)
        if (contextBlock && provider.getSystemPrompt && provider.setSystemPrompt) {
            const currentPrompt = provider.getSystemPrompt()
            if (!currentPrompt.includes("AUTO-INJECTED")) {
                provider.setSystemPrompt(currentPrompt + contextBlock)
            }
        }
    }, _activeConfig.debounceMs)
    context.subscriptions.push({ dispose: () => watcher.dispose() })

    // 2. Status Bar
    const statusBar = new WorkflowStatusBar()
    statusBar.startPolling(() => {
        try {
            if (!fs.existsSync(statusFilePath)) return null
            const data = JSON.parse(fs.readFileSync(statusFilePath, "utf8"))
            return {
                currentState: data.currentState || "INIT",
                phase: data.phase || "",
                retryCount: data.retryCount || 0,
                autopilot: !!data.autopilot,
                status: data.status || "IN_PROGRESS",
                cycleStart: data.cycleStart || "",
            }
        } catch {
            return null
        }
    }, _activeConfig.pollingIntervalMs)
    context.subscriptions.push({ dispose: () => statusBar.dispose() })

    // 3. Gate Validator Command (Ctrl+Shift+G)
    const gateValidator = new GateValidator()
    gateValidator.registerCommands(context, workspaceRoot)

    // 4. Commands
    context.subscriptions.push(
        vscode.commands.registerCommand("roo-code.openWorkflowDashboard", () => {
            WorkflowDashboardPanel.createOrShow(context.extensionUri)
        })
    )

    // 5. Status Bar Icon click handler
    context.subscriptions.push(
        vscode.commands.registerCommand("roo-code.showWorkflowStatus", () => {
            // Priority 1: Open Dashboard
            // Priority 2: Fallback to opening status JSON
            try {
                vscode.commands.executeCommand("roo-code.openWorkflowDashboard")
            } catch {
                const statusUri = vscode.Uri.file(statusFilePath)
                vscode.window.showTextDocument(statusUri)
            }
        })
    )

    // 6. Reload Config Command
    context.subscriptions.push(
        vscode.commands.registerCommand("roo-code.reloadWorkflowConfig", () => {
            _activeConfig = loadConfig(workspaceRoot)
            vscode.window.showInformationMessage("🔄 Workflow config reloaded from workflow-config.json")
        })
    )

    console.log("[Workflow] Integration activated successfully.")
}

/**
 * Resolve the token budget for a given mode.
 * Uses configurable budgets from workflow-config.json.
 * Called from the API layer when computing maxTokens for a model.
 */
export function resolveTokenBudget(activeMode: string, defaultMax: number): number {
    return _activeConfig.tokenBudgets[activeMode] ?? defaultMax
}
