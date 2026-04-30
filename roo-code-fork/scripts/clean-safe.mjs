#!/usr/bin/env node
/**
 * Cross-platform "rimraf" replacement that survives the Windows-specific
 * EPERM issue where the turbo daemon holds .turbo/daemon/*.log open during
 * `pnpm clean`. Uses fs.rmSync with maxRetries+retryDelay (Node ≥ 14.14)
 * and silently tolerates EPERM/EBUSY/ENOENT.
 *
 * Usage: node scripts/clean-safe.mjs <target> [<target> ...]
 */
import { rmSync } from "node:fs"
import { resolve } from "node:path"

const targets = process.argv.slice(2)
if (targets.length === 0) {
	console.error("clean-safe: no targets given")
	process.exit(1)
}

let hadFatal = false
for (const t of targets) {
	const full = resolve(t)
	try {
		rmSync(full, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 200,
		})
	} catch (err) {
		if (err && (err.code === "EPERM" || err.code === "EBUSY" || err.code === "ENOENT")) {
			console.warn(`clean-safe: skipped ${t} (${err.code}) — likely held by another process; safe to ignore`)
			continue
		}
		console.error(`clean-safe: failed to remove ${t}:`, err.message)
		hadFatal = true
	}
}
process.exit(hadFatal ? 1 : 0)
