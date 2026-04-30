const { execSync } = require("child_process")
const fs = require("fs")
const path = require("path")
const os = require("os")
const readline = require("readline")

// detect "yes" flags
const autoYes = process.argv.includes("-y")

// detect nightly flag
const isNightly = process.argv.includes("--nightly")

// detect editor command from args or default to "code"
const editorArg = process.argv.find((arg) => arg.startsWith("--editor="))
const defaultEditor = editorArg ? editorArg.split("=")[1] : "code"

/**
 * Resolve a VS Code-family CLI to a callable command.
 *
 * On Windows, VS Code's `code` shim is often missing from PATH (it's only
 * added when the user runs the in-app "Shell Command: Install 'code' command
 * in PATH"). We try, in order:
 *   1. The bare command from PATH.
 *   2. Common Windows install locations (User + System installer + Insiders + Cursor).
 *   3. macOS / Linux common locations.
 *
 * Returns a quoted absolute path (Windows-safe) or the bare command if it works.
 */
function resolveEditorCommand(name) {
	// Quick check: is `<name> --version` callable from PATH?
	try {
		execSync(`${name} --version`, { stdio: "ignore" })
		return name
	} catch {
		// fall through to filesystem search
	}

	const cmdName = process.platform === "win32" ? `${name}.cmd` : name
	const candidates = []

	if (process.platform === "win32") {
		const userHome = os.homedir()
		const programFiles = process.env["ProgramFiles"] || "C:\\Program Files"
		const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)"
		const localAppData = process.env["LOCALAPPDATA"] || path.join(userHome, "AppData", "Local")

		const winNameMap = {
			code: ["Microsoft VS Code", "Code.exe", "bin/code.cmd"],
			"code-insiders": ["Microsoft VS Code Insiders", "Code - Insiders.exe", "bin/code-insiders.cmd"],
			cursor: ["cursor", "Cursor.exe", "resources/app/bin/cursor.cmd"],
		}
		const m = winNameMap[name]
		if (m) {
			const [folder, _exe, binRelative] = m
			candidates.push(
				path.join(localAppData, "Programs", folder, "bin", path.basename(binRelative)),
				path.join(programFiles, folder, "bin", path.basename(binRelative)),
				path.join(programFilesX86, folder, "bin", path.basename(binRelative)),
			)
		}
	} else {
		// macOS / Linux
		candidates.push(
			"/usr/local/bin/" + name,
			"/usr/bin/" + name,
			"/snap/bin/" + name,
			"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/" + name,
		)
	}

	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			try {
				execSync(`"${candidate}" --version`, { stdio: "ignore" })
				return `"${candidate}"`
			} catch {
				// keep looking
			}
		}
	}

	return null
}

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
})

const askQuestion = (question) => {
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			resolve(answer)
		})
	})
}

async function main() {
	try {
		let name, version, publisher

		if (isNightly) {
			// For nightly, read the nightly-specific package.json and get publisher from src
			const nightlyPackageJson = JSON.parse(
				fs.readFileSync("./apps/vscode-nightly/package.nightly.json", "utf-8"),
			)
			const srcPackageJson = JSON.parse(fs.readFileSync("./src/package.json", "utf-8"))
			name = nightlyPackageJson.name
			version = nightlyPackageJson.version
			publisher = srcPackageJson.publisher
		} else {
			const packageJson = JSON.parse(fs.readFileSync("./src/package.json", "utf-8"))
			name = packageJson.name
			version = packageJson.version
			publisher = packageJson.publisher
		}

		const vsixFileName = `./bin/${name}-${version}.vsix`
		const extensionId = `${publisher}.${name}`
		const buildType = isNightly ? "Nightly" : "Regular"

		console.log(`\n🚀 Roo Code VSIX Installer (${buildType})`)
		console.log("========================")
		console.log("\nThis script will:")
		console.log("1. Uninstall any existing version of the Roo Code extension")
		console.log("2. Install the newly built VSIX package")
		console.log(`\nExtension: ${extensionId}`)
		console.log(`VSIX file: ${vsixFileName}`)

		// Ask for editor command if not provided
		let editorCommand = defaultEditor
		if (!editorArg && !autoYes) {
			const editorAnswer = await askQuestion(
				"\nWhich editor command to use? (code/cursor/code-insiders) [default: code]: ",
			)
			if (editorAnswer.trim()) {
				editorCommand = editorAnswer.trim()
			}
		}

		// skip prompt if auto-yes
		const answer = autoYes ? "y" : await askQuestion("\nDo you wish to continue? (y/n): ")

		if (answer.toLowerCase() !== "y") {
			console.log("Installation cancelled.")
			rl.close()
			process.exit(0)
		}

		// If the user passed --editor=ALL, install into every editor we can find on the box.
		if (editorCommand.toLowerCase() === "all") {
			const editors = ["code", "code-insiders", "cursor"]
			let installedAny = false
			for (const ed of editors) {
				const r = resolveEditorCommand(ed)
				if (!r) { console.log(`(skip ${ed}: not installed)`); continue }
				console.log(`\n=== Installing into ${ed} (${r}) ===`)
				try { execSync(`${r} --uninstall-extension ${extensionId}`, { stdio: "inherit" }) } catch {}
				execSync(`${r} --install-extension ${vsixFileName}`, { stdio: "inherit" })
				installedAny = true
			}
			if (!installedAny) {
				console.error("❌ No supported editor found on PATH or in standard install locations.")
				rl.close(); process.exit(1)
			}
			console.log(`\n✅ Installed into all detected editors.\n⚠️  Fully close every editor window then reopen for the change to take effect.\n`)
			rl.close(); process.exit(0)
		}

		console.log(`\nLocating '${editorCommand}' CLI...`)
		const resolved = resolveEditorCommand(editorCommand)
		if (!resolved) {
			console.error(`\n❌ Could not find the '${editorCommand}' CLI on PATH or in any common install location.`)
			console.error("   The VSIX itself was built successfully — install it manually:\n")
			console.error(`     1. Open VS Code`)
			console.error(`     2. Ctrl+Shift+P  →  "Extensions: Install from VSIX..."`)
			console.error(`     3. Pick: ${path.resolve(vsixFileName)}`)
			console.error(`     4. Ctrl+Shift+P  →  "Developer: Reload Window"\n`)
			console.error(`   To make 'code' available on PATH for next time, run inside VS Code:`)
			console.error(`     Ctrl+Shift+P  →  "Shell Command: Install 'code' command in PATH"\n`)
			rl.close()
			process.exit(1)
		}
		const editorBin = resolved
		console.log(`Using: ${editorBin}`)

		try {
			execSync(`${editorBin} --uninstall-extension ${extensionId}`, { stdio: "inherit" })
		} catch (e) {
			console.log("Extension not installed, skipping uninstall step")
		}

		if (!fs.existsSync(vsixFileName)) {
			console.error(`\n❌ VSIX file not found: ${vsixFileName}`)
			console.error("Make sure the build completed successfully")
			rl.close()
			process.exit(1)
		}

		execSync(`${editorBin} --install-extension ${vsixFileName}`, { stdio: "inherit" })

		console.log(`\n✅ Successfully installed extension from ${vsixFileName}`)
		console.log("\n⚠️  IMPORTANT: You need to restart VS Code for the changes to take effect.")
		console.log("   Please close and reopen VS Code to use the updated extension.\n")

		rl.close()
	} catch (error) {
		console.error("\n❌ Failed to install extension:", error.message)
		rl.close()
		process.exit(1)
	}
}

main()
