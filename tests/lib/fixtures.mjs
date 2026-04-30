/**
 * Test fixtures and helpers shared across suites.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, cpSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { http } from './runner.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(__dirname, '..', '..')

/** Create a fresh isolated workspace (so tests don't touch the real WORKFLOW/) */
export function makeTempWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'rooflow-test-'))
  // Copy the orchestrator + dashboard + workflow-config so PowerShell scripts work
  cpSync(join(REPO_ROOT, 'orchestrator.ps1'), join(dir, 'orchestrator.ps1'))
  cpSync(join(REPO_ROOT, 'init-workflow.ps1'), join(dir, 'init-workflow.ps1'))
  cpSync(join(REPO_ROOT, 'workflow-dashboard'), join(dir, 'workflow-dashboard'), { recursive: true })
  return {
    dir,
    cleanup() { try { rmSync(dir, { recursive: true, force: true }) } catch {} }
  }
}

/** Boot the dashboard server on a random free port. Returns the controller. */
export async function bootDashboard({ cwd, port }) {
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1' }
  const proc = spawn(process.execPath, [join(cwd, 'workflow-dashboard', 'server.js')], {
    cwd, env, stdio: ['ignore', 'pipe', 'pipe']
  })
  let out = '', err = ''
  proc.stdout.on('data', d => out += d.toString())
  proc.stderr.on('data', d => err += d.toString())

  // Wait until port is responsive
  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const r = await http(`${base}/api/status`)
    if (r.status === 200) {
      return {
        proc, base,
        stop() { try { proc.kill('SIGTERM') } catch {}  },
        getOutput() { return { out, err } },
      }
    }
    await new Promise(r => setTimeout(r, 150))
  }
  proc.kill('SIGTERM')
  throw new Error(`Dashboard did not become ready on ${base} within 8s\nstdout: ${out}\nstderr: ${err}`)
}

/** Run orchestrator.ps1 with arguments in the given workspace */
export function runOrchestrator(cwd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', join(cwd, 'orchestrator.ps1'),
      ...args
    ], { cwd })
    let stdout = '', stderr = ''
    proc.stdout.on('data', d => stdout += d.toString())
    proc.stderr.on('data', d => stderr += d.toString())
    proc.on('close', code => resolve({ code, stdout, stderr }))
    proc.on('error', reject)
  })
}

/** Run init-workflow.ps1 (with -SkipDashboard so we don't npm install in tests) */
export async function runInit(cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', join(cwd, 'init-workflow.ps1'),
      '-SkipDashboard'
    ], { cwd })
    let stdout = '', stderr = ''
    proc.stdout.on('data', d => stdout += d.toString())
    proc.stderr.on('data', d => stderr += d.toString())
    proc.on('close', code => resolve({ code, stdout, stderr }))
    proc.on('error', reject)
  })
}

/** Read & parse the orchestrator's status JSON file in a workspace.
 *  PowerShell's Set-Content -Encoding UTF8 writes a BOM on Windows PS 5.1 — strip it
 *  before JSON.parse, which would otherwise throw on the leading U+FEFF.
 */
export function readStatus(cwd) {
  const path = join(cwd, 'WORKFLOW', 'ORCHESTRATION_STATUS.json')
  if (!existsSync(path)) return null
  try {
    let raw = readFileSync(path, 'utf8')
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1)
    return JSON.parse(raw)
  } catch { return null }
}

/** Write content to a file inside a workspace, creating parents */
export function writeFile(cwd, relPath, content) {
  const full = join(cwd, relPath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content, 'utf8')
}

/** Pick a free port (asks the OS for one) */
export async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}
