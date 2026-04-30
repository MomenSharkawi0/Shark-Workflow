import * as http from "http"
import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"
import { exec } from "child_process"
import type { ClineProviderLike } from "./index"
import { WorkflowEngine, type EngineEvent } from "./WorkflowEngine"

interface BridgeProvider extends ClineProviderLike {
    createTask?(text?: string, images?: string[]): Promise<any>
    cancelTask?(): Promise<void>
    clearTask?(): Promise<void>
    getMode?(): Promise<string>
    getModes?(): Promise<{ slug: string; name: string }[]>
    getCurrentTask?(): any
    postMessageToWebview?(message: any): Promise<void>
}

/**
 * WorkflowBridge — Unified HTTP API & Static File Server for the Workflow Dashboard
 * 
 * Ported from server.js and enhanced for extension integration.
 * Starts on port 3001 by default.
 */
export class WorkflowBridge {
    private server: http.Server | undefined
    private port: number
    private engine: WorkflowEngine | null = null
    private sseClients: http.ServerResponse[] = []
    
    // Activity Log & Chat History (ported from server.js)
    private activityLog: Array<{ timestamp: string; type: string; message: string; level: string }> = []
    private chatHistory: Array<{ id: string; role: string; content: string; timestamp: string; status: string }> = []
    private chatIdCounter = 0
    private readonly MAX_LOG = 200

    constructor(private provider: BridgeProvider, port: number = 3001) {
        this.port = port
    }

    initEngine(workspaceRoot: string): void {
        this.engine = new WorkflowEngine(this.provider, workspaceRoot)
        this.engine.onEvent((event) => {
            this.broadcastSSE(event)
            // Log relevant events to activity log
            if (event.type === 'state_change') {
                this.logActivity('status', `State → ${event.state}`, 'info')
            } else if (event.type === 'eval') {
                this.logActivity('gate', event.message || 'Evaluation complete', 'info')
            }
        })
        this.startFileWatchers(workspaceRoot)
        console.log("[WorkflowBridge] WorkflowEngine initialized")
    }

    private logActivity(type: string, message: string, level: string = 'info') {
        const entry = { timestamp: new Date().toISOString(), type, message, level }
        this.activityLog.unshift(entry)
        if (this.activityLog.length > this.MAX_LOG) this.activityLog.length = this.MAX_LOG
        this.broadcastSSE({ type: 'activity', ...entry } as any)
    }

    private startFileWatchers(workspaceRoot: string) {
        const logFile = path.join(workspaceRoot, 'WORKFLOW', 'orchestrator.log')
        const statusFile = path.join(workspaceRoot, 'WORKFLOW', 'ORCHESTRATION_STATUS.json')
        let lastLogSize = 0
        let lastStatusHash = ''
        
        // Watch ORCHESTRATION_STATUS.json for changes
        setInterval(() => {
            try {
                if (!fs.existsSync(statusFile)) return
                const raw = fs.readFileSync(statusFile, 'utf-8')
                const hash = Buffer.from(raw).toString('base64').slice(0, 32)
                if (hash !== lastStatusHash) {
                    lastStatusHash = hash
                    const data = JSON.parse(raw)
                    this.broadcastSSE({ type: 'status_change', ...data } as any)
                }
            } catch {}
        }, 800)

        // Watch orchestrator.log for new lines
        setInterval(() => {
            try {
                if (!fs.existsSync(logFile)) return
                const stat = fs.statSync(logFile)
                if (stat.size > lastLogSize) {
                    const fd = fs.openSync(logFile, 'r')
                    const buf = Buffer.alloc(stat.size - lastLogSize)
                    fs.readSync(fd, buf, 0, buf.length, lastLogSize)
                    fs.closeSync(fd)
                    const newLines = buf.toString('utf-8').split('\n').filter(l => l.trim())
                    newLines.forEach(line => {
                        const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\] (.+)$/)
                        if (match) {
                            this.logActivity('log', match[3], match[2].toLowerCase())
                        }
                    })
                    lastLogSize = stat.size
                }
            } catch {}
        }, 1000)
    }

    start(): void {
        this.server = http.createServer(async (req, res) => {
            res.setHeader("Access-Control-Allow-Origin", "*")
            res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE")
            res.setHeader("Access-Control-Allow-Headers", "Content-Type")
            if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return }
            
            const url = req.url || ""
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ""

            try {
                // === AGENT ENDPOINTS ===
                if (url === "/bridge/ping" && req.method === "GET") {
                    this.sendJson(res, { ok: true, version: "5.0", engine: !!this.engine }); return
                }
                
                // === ENGINE & API ENDPOINTS ===
                if (url === "/api/status" && req.method === "GET") {
                    if (!this.engine) { this.sendJson(res, { error: "Engine not initialized" }, 503); return }
                    const state = this.engine.getState()
                    this.sendJson(res, {
                        'Current State': state.currentState,
                        'Previous State': (state as any).previousState || '',
                        'Phase': state.phase || '',
                        'Cycle Start': state.cycleStart || '',
                        'Last Transition': (state as any).lastTransition || '',
                        'Transition Count': String(state.transitionCount || 0),
                        'Retry Count': String(state.retryCount || 0),
                        'Next Action': (state as any).nextAction || '',
                        'Next Mode': (state as any).nextMode || '',
                        'Status': state.status || 'IN_PROGRESS',
                        'Blocked Reason': (state as any).blockedReason || '',
                        'Autopilot': state.autopilot ? 'ON' : 'OFF',
                        _raw: state
                    }); return
                }

                if (url === "/api/events" && req.method === "GET") {
                    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" })
                    res.write('data: {"type":"connected"}\n\n')
                    
                    // Send current state immediately
                    if (this.engine) {
                        res.write(`data: ${JSON.stringify({ type: 'status_change', ...this.engine.getState() })}\n\n`)
                    }
                    
                    this.sseClients.push(res)
                    req.on("close", () => { this.sseClients = this.sseClients.filter((c) => c !== res) })
                    return
                }

                if (url === "/api/progress" && req.method === "GET") {
                    if (!this.engine) { this.sendJson(res, { error: "Engine not initialized" }, 503); return }
                    const state = this.engine.getState()
                    const currentState = state.currentState || 'INIT'
                    const cycleStart = state.cycleStart
                    
                    const STATES = ['INIT','PHASE_PLANNING','DETAILED_PLANNING','PLAN_REVIEW','EXECUTION','EXECUTION_REVIEW','ARCHIVE','COMPLETE']
                    const stateIdx = STATES.indexOf(currentState)
                    const totalStates = STATES.length - 1
                    const percentComplete = stateIdx >= 0 ? Math.round((stateIdx / totalStates) * 100) : 0
                    
                    // Historical analysis from METRICS.json
                    const metricsFile = path.join(workspaceRoot, 'WORKFLOW', 'METRICS.json')
                    let avgCycleDurationMin = 0
                    let estimatedRemainingMin = 0
                    let confidence = 'low'
                    let completedCycles = 0
                    
                    if (fs.existsSync(metricsFile)) {
                        try {
                            const metrics = JSON.parse(fs.readFileSync(metricsFile, 'utf-8'))
                            const cycles = metrics.cycles || []
                            completedCycles = cycles.length
                            if (cycles.length > 0) {
                                avgCycleDurationMin = Math.round(cycles.reduce((s: any, c: any) => s + (c.durationMinutes || 0), 0) / cycles.length)
                                confidence = cycles.length >= 5 ? 'high' : cycles.length >= 2 ? 'medium' : 'low'
                            }
                            if (cycleStart && avgCycleDurationMin > 0) {
                                const elapsedMin = (Date.now() - new Date(cycleStart).getTime()) / 60000
                                const remainingFraction = (totalStates - stateIdx) / totalStates
                                estimatedRemainingMin = Math.max(0, Math.round(avgCycleDurationMin * remainingFraction - elapsedMin * remainingFraction))
                            }
                        } catch {}
                    }
                    
                    this.sendJson(res, {
                        currentState, stateIndex: stateIdx, totalStates, percentComplete,
                        elapsedMin: cycleStart ? Math.round((Date.now() - new Date(cycleStart).getTime()) / 60000) : 0,
                        estimatedRemainingMin, estimatedTotalMin: avgCycleDurationMin,
                        confidence, completedCycles, phasesRemaining: totalStates - stateIdx
                    }); return
                }

                if (url === "/api/chat/history" && req.method === "GET") {
                    this.sendJson(res, { messages: this.chatHistory.slice(-50) }); return
                }

                if (url === "/api/chat/send" && req.method === "POST") {
                    const { message } = JSON.parse(await this.readBody(req))
                    if (!message) { this.sendJson(res, { error: "Missing message" }, 400); return }

                    const userMsg = {
                        id: `msg_${++this.chatIdCounter}`,
                        role: 'user', content: message,
                        timestamp: new Date().toISOString(), status: 'sent'
                    }
                    this.chatHistory.push(userMsg)
                    this.broadcastSSE({ type: 'chat_message', ...userMsg } as any)
                    this.logActivity('chat', `User: ${message.substring(0, 80)}`, 'info')

                    // === INTELLIGENT CHAT ROUTING ===
                    // If we are at INIT (no cycle in progress) and the engine is available,
                    // treat this message as the feature request that kicks off a new workflow.
                    // The engine writes FEATURE_REQUEST.md, advances INIT -> PHASE_PLANNING,
                    // switches the agent to Director mode, and (in semi/full-auto) sends the
                    // generated Director prompt automatically.
                    //
                    // If a cycle is already in progress, forward the chat message to the
                    // currently active task as a follow-up note (legacy behavior).
                    let success = false
                    let routingNote = ''
                    const engineState = this.engine ? this.engine.getState() : null
                    const isAtInit = engineState && (engineState.phase === "INIT" || !engineState.isRunning)

                    if (this.engine && isAtInit) {
                        const result = await this.engine.startCycle(message)
                        success = !!result.success
                        routingNote = success
                            ? '🚀 Workflow cycle started. Switching to Director mode and beginning PHASE_PLANNING.'
                            : `❌ Failed to start cycle: ${result.error || 'unknown error'}`
                    } else {
                        const currentTask = this.provider.getCurrentTask ? this.provider.getCurrentTask() : null
                        if (currentTask && this.provider.postMessageToWebview) {
                            await this.provider.postMessageToWebview({ type: "invoke", invoke: "sendMessage", text: message })
                            success = true
                            routingNote = '✅ Message delivered to active task.'
                        } else if (this.provider.createTask) {
                            await this.provider.createTask(message)
                            success = true
                            routingNote = '✅ Message delivered as a new task.'
                        } else {
                            routingNote = '❌ No active task and createTask is unavailable.'
                        }
                    }

                    const agentMsg = {
                        id: `msg_${++this.chatIdCounter}`,
                        role: 'agent',
                        content: routingNote || (success ? '✅ Delivered.' : '❌ Failed.'),
                        timestamp: new Date().toISOString(), status: success ? 'delivered' : 'failed'
                    }
                    this.chatHistory.push(agentMsg)
                    this.broadcastSSE({ type: 'chat_message', ...agentMsg } as any)
                    this.sendJson(res, { success, userMsg, agentMsg }); return
                }

                // === EXPLICIT WORKFLOW CONTROL ===
                if (url === "/api/cycle/start" && req.method === "POST") {
                    if (!this.engine) { this.sendJson(res, { error: "Engine not initialized" }, 503); return }
                    const body = JSON.parse(await this.readBody(req) || "{}")
                    const featureRequest = (body.featureRequest || "").toString().trim()
                    if (!featureRequest) { this.sendJson(res, { error: "featureRequest is required" }, 400); return }
                    if (body.autonomy && ["manual", "semi-auto", "full-auto"].includes(body.autonomy)) {
                        this.engine.setAutonomy(body.autonomy)
                    }
                    const stack = typeof body.stack === "string" ? body.stack.trim() : undefined
                    const result = await this.engine.startCycle(featureRequest, stack ? { manualStack: stack } : undefined)
                    this.logActivity('cycle', `startCycle ${result.success ? 'OK' : 'FAILED'}: ${featureRequest.substring(0, 60)}`, result.success ? 'ok' : 'fail')
                    this.sendJson(res, { ...result, state: this.engine.getState() }); return
                }

                if (url === "/api/cycle/abort" && req.method === "POST") {
                    if (!this.engine) { this.sendJson(res, { error: "Engine not initialized" }, 503); return }
                    const result = (this.engine as any).abort ? await (this.engine as any).abort() : { success: true }
                    this.logActivity('cycle', `abort cycle`, 'warn')
                    this.sendJson(res, { ...result, state: this.engine.getState() }); return
                }

                if (url === "/api/autonomy" && req.method === "POST") {
                    if (!this.engine) { this.sendJson(res, { error: "Engine not initialized" }, 503); return }
                    const { level } = JSON.parse(await this.readBody(req) || "{}")
                    if (!["manual", "semi-auto", "full-auto"].includes(level)) {
                        this.sendJson(res, { error: "level must be manual | semi-auto | full-auto" }, 400); return
                    }
                    this.engine.setAutonomy(level)
                    this.logActivity('autonomy', `Autonomy set to ${level}`, 'info')
                    this.sendJson(res, { success: true, level, state: this.engine.getState() }); return
                }

                if (url === "/api/mode/switch" && req.method === "POST") {
                    const { mode } = JSON.parse(await this.readBody(req) || "{}")
                    const allowed = ["director", "planner", "executor", "workflow-master", "code", "ask", "architect", "debug"]
                    if (!mode || !allowed.includes(mode)) {
                        this.sendJson(res, { error: `mode must be one of: ${allowed.join(", ")}` }, 400); return
                    }
                    if (!this.provider.setMode) {
                        this.sendJson(res, { error: "provider.setMode unavailable" }, 503); return
                    }
                    try {
                        await this.provider.setMode(mode)
                        ;(globalThis as any).__rooWorkflowMode = mode
                        this.logActivity('mode', `Mode switched to ${mode}`, 'ok')
                        this.sendJson(res, { success: true, mode }); return
                    } catch (err: any) {
                        this.sendJson(res, { success: false, error: err?.message || String(err) }, 500); return
                    }
                }

                if (url === "/api/mode/current" && req.method === "GET") {
                    const mode = (globalThis as any).__rooWorkflowMode || (this.engine ? this.engine.getState().currentMode : null) || null
                    this.sendJson(res, { mode }); return
                }

                if (url.startsWith("/api/next") || url.startsWith("/api/reset") || url.startsWith("/api/undo") || url.startsWith("/api/resume")) {
                    const flag = url.split('/').pop()?.replace('api', '-') || ''
                    const scriptPath = path.join(workspaceRoot, 'orchestrator.ps1')
                    const cmd = `powershell.exe -ExecutionPolicy Bypass -File "${scriptPath}" -${flag.charAt(0).toUpperCase() + flag.slice(1)}`
                    this.logActivity('command', `Executing: orchestrator.ps1 -${flag}`, 'info')
                    
                    exec(cmd, { cwd: workspaceRoot }, (error, stdout, stderr) => {
                        this.logActivity('command', `-${flag} → ${!error ? 'SUCCESS' : 'FAILED'}`, !error ? 'ok' : 'fail')
                        this.sendJson(res, { success: !error, stdout, stderr, error: error?.message })
                    })
                    return
                }

                // === STATIC FILE SERVING (Phase 3b) ===
                let filePath = url === "/" ? "index.html" : url.substring(1)
                const dashboardPublic = path.join(workspaceRoot, "workflow-dashboard", "public")
                const fullPath = path.join(dashboardPublic, filePath)

                if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
                    const ext = path.extname(fullPath).toLowerCase()
                    const mimeMap: Record<string, string> = {
                        ".html": "text/html",
                        ".css": "text/css",
                        ".js": "application/javascript",
                        ".json": "application/json",
                        ".png": "image/png",
                        ".svg": "image/svg+xml"
                    }
                    res.writeHead(200, { "Content-Type": mimeMap[ext] || "text/plain" })
                    res.end(fs.readFileSync(fullPath))
                    return
                }

                this.sendJson(res, { error: "Not found" }, 404)
            } catch (err: any) {
                console.error("[WorkflowBridge] Error:", err)
                this.sendJson(res, { error: err.message || "Internal error" }, 500)
            }
        })
        this.server.listen(this.port, "127.0.0.1", () => {
            console.log(`[WorkflowBridge] Unified Dashboard Server on http://127.0.0.1:${this.port}`)
        })
    }

    dispose(): void {
        this.server?.close(); this.engine?.dispose()
        this.sseClients.forEach((c) => { try { c.end() } catch {} })
        this.sseClients = []
    }

    private broadcastSSE(event: EngineEvent): void {
        const data = JSON.stringify(event)
        this.sseClients.forEach((c) => { try { c.write(`data: ${data}\n\n`) } catch {} })
    }

    private sendJson(res: http.ServerResponse, data: any, status: number = 200): void {
        res.setHeader("Content-Type", "application/json")
        res.writeHead(status)
        res.end(JSON.stringify(data))
    }

    private async readBody(req: http.IncomingMessage): Promise<string> {
        return new Promise((resolve, reject) => {
            let body = ""
            req.on("data", (chunk: any) => (body += chunk))
            req.on("end", () => resolve(body))
            req.on("error", reject)
        })
    }
}
