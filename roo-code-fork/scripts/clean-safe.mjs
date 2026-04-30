#!/usr/bin/env node
/**
 * Cross-platform "rimraf" replacement that survives the Windows-specific
 * race where the turbo daemon writes new entries to .turbo/daemon/*.log
 * faster than rimraf can delete the directory, causing EPERM (file locked)
 * or ENOTEMPTY (sibling re-created mid-traversal).
 *
 * Strategy:
 *   1. Best-effort `turbo daemon stop` so the daemon releases its log file.
 *   2. fs.rmSync with maxRetries (handles transient locks).
 *   3. Tolerate EPERM, EBUSY, EACCES, ENOTEMPTY, ENOENT — they all mean
 *      "another process is still touching this; the next run will clean it".
 *
 * Usage: node scripts/clean-safe.mjs <target> [<target> ...]
 */
import { rmSync } from "node:fs"
import { resolve } from "node:path"
import { execSync } from "node:child_process"

const targets = process.argv.slice(2)
if (targets.length === 0) {
	console.error("clean-safe: no targets given")
	process.exit(1)
}

// Step 1: ask turbo to stop its daemon so the log file is closed.
// `pnpm exec` finds the workspace's installed turbo binary; falls back to PATH.
function stopTurboDaemon() {
	const tries = [
		"pnpm exec turbo daemon stop",
		"npx --no-install turbo daemon stop",
		"turbo daemon stop",
	]
	for (const cmd of tries) {
		try {
			execSync(cmd, { stdio: "ignore", timeout: 5000 })
			return
		} catch {
			// Try next form
		}
	}
	// All failed — daemon may not have been running, which is fine.
}
stopTurboDaemon()

const tolerated = new Set(["EPERM", "EBUSY", "EACCES", "ENOTEMPTY", "ENOENT"])

let hadFatal = false
for (const t of targets) {
	const full = resolve(t)
	let lastErr = null
	// One more retry layer on top of fs.rmSync's internal retries —
	// gives the daemon process a chance to fully unwind.
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			rmSync(full, {
				recursive: true,
				force: true,
				maxRetries: 15,
				retryDelay: 300,
			})
			lastErr = null
			break
		} catch (err) {
			lastErr = err
			if (!err || !tolerated.has(err.code)) break
		}
	}
	if (lastErr) {
		if (tolerated.has(lastErr.code)) {
			console.warn(`clean-safe: skipped ${t} (${lastErr.code}) — another process holds it; will be cleaned on next run`)
		} else {
			console.error(`clean-safe: failed to remove ${t}:`, lastErr.message)
			hadFatal = true
		}
	}
}
process.exit(hadFatal ? 1 : 0)
