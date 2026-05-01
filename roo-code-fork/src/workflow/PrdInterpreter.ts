/**
 * PrdInterpreter — heuristic markdown classifier + field extractor.
 *
 * Pure logic, NO LLM call. Run as the first pass on any incoming markdown
 * (PRD, plan, notion export). When confidence is high (>= 0.6) we can ship
 * the result straight to the wizard; when low, the dashboard may invoke
 * `/api/ingest/interpret` on the bridge to get an LLM uplift.
 *
 * The output type matches what `workflow-dashboard/server.js`
 * `buildFeatureRequest()` consumes, so callers can hand it to the
 * existing wizard pipeline without an adapter.
 */

export type InterpretedKind = "prd" | "plan" | "hybrid" | "unknown"

export interface FieldWithConfidence<T = string> {
	value: T
	confidence: number // 0..1
}

export interface InterpretedPrd {
	projectName: FieldWithConfidence<string>
	projectType: FieldWithConfidence<string>
	summary: FieldWithConfidence<string>
	dataModel: FieldWithConfidence<string>
	constraints: FieldWithConfidence<string>
	successCriteria: FieldWithConfidence<string>
	stackHints: FieldWithConfidence<string[]>
	originalSections: { heading: string; level: number; body: string }[]
}

export interface ClassifyResult {
	kind: InterpretedKind
	signals: string[]
	confidence: number // 0..1 for the kind classification itself
}

const PLAN_SIGNALS: { pattern: RegExp; weight: number; label: string }[] = [
	{ pattern: /^##\s+Files to Modify\b/im, weight: 0.4, label: "## Files to Modify" },
	{ pattern: /^##\s+Implementation Steps\b/im, weight: 0.35, label: "## Implementation Steps" },
	{ pattern: /^##\s+Phase\s+\d/im, weight: 0.2, label: "## Phase N" },
	{ pattern: /STATUS:\s*(APPROVED|NEEDS_REVISION)/i, weight: 0.25, label: "STATUS:" },
	{ pattern: /^\|\s*File\s*\|\s*Action/im, weight: 0.2, label: "files-table header" },
	{ pattern: /^##\s+Risk\s+Assessment\b/im, weight: 0.1, label: "## Risk Assessment" },
	{ pattern: /^##\s+Rollback\s+Plan\b/im, weight: 0.1, label: "## Rollback Plan" },
]

const PRD_SIGNALS: { pattern: RegExp; weight: number; label: string }[] = [
	{ pattern: /^##\s+(User\s+)?Stories\b/im, weight: 0.3, label: "## User Stories" },
	{ pattern: /^##\s+Goals?\b/im, weight: 0.25, label: "## Goals" },
	{ pattern: /^##\s+Success\s+(Metrics|Criteria)\b/im, weight: 0.25, label: "## Success Metrics" },
	{ pattern: /^##\s+Scope\b/im, weight: 0.2, label: "## Scope" },
	{ pattern: /^##\s+Requirements?\b/im, weight: 0.2, label: "## Requirements" },
	{ pattern: /^##\s+Background\b/im, weight: 0.15, label: "## Background" },
	{ pattern: /^##\s+(Personas?|Target\s+Users?)\b/im, weight: 0.15, label: "## Personas" },
	{ pattern: /^##\s+(Product\s+)?Vision\b/im, weight: 0.15, label: "## Vision" },
	{ pattern: /^##\s+(Out\s+of\s+Scope|Non-Goals)\b/im, weight: 0.15, label: "## Out of Scope" },
	{ pattern: /^##\s+(Use\s+Cases?|Scenarios)\b/im, weight: 0.15, label: "## Use Cases" },
	{ pattern: /Product\s+Requirements?\s+Document/i, weight: 0.2, label: "PRD title" },
]

const STACK_KEYWORDS: { regex: RegExp; hint: string }[] = [
	{ regex: /\bLaravel\b/i, hint: "Laravel" },
	{ regex: /\bFilament\s*(v3|v4)?\b/i, hint: "Filament (Laravel admin panel)" },
	{ regex: /\bLivewire\s*(v3)?\b/i, hint: "Livewire (Laravel)" },
	{ regex: /\bDjango\b/i, hint: "Django" },
	{ regex: /\bFastAPI\b/i, hint: "FastAPI" },
	{ regex: /\bFlask\b/i, hint: "Flask" },
	{ regex: /\bRails\b/i, hint: "Ruby on Rails" },
	{ regex: /\bNest\.?JS\b/i, hint: "NestJS" },
	{ regex: /\bExpress(\.js)?\b/i, hint: "Express" },
	{ regex: /\bNext\.?js\b/i, hint: "Next.js" },
	{ regex: /\bRemix\b/i, hint: "Remix" },
	{ regex: /\bVue\b/i, hint: "Vue" },
	{ regex: /\bNuxt\b/i, hint: "Nuxt" },
	{ regex: /\bSvelte(Kit)?\b/i, hint: "SvelteKit" },
	{ regex: /\bAstro\b/i, hint: "Astro" },
	{ regex: /\bReact\s+Native\b/i, hint: "React Native" },
	{ regex: /\bExpo\b/i, hint: "Expo (React Native)" },
	{ regex: /\bFlutter\b/i, hint: "Flutter" },
	{ regex: /\bPostgres(QL)?\b/i, hint: "PostgreSQL" },
	{ regex: /\bMySQL\b/i, hint: "MySQL" },
	{ regex: /\bMariaDB\b/i, hint: "MariaDB" },
	{ regex: /\bSQLite\b/i, hint: "SQLite" },
	{ regex: /\bMongoDB\b/i, hint: "MongoDB" },
	{ regex: /\bRedis\b/i, hint: "Redis" },
	{ regex: /\bSupabase\b/i, hint: "Supabase" },
	{ regex: /\bFirestore\b/i, hint: "Firestore" },
	{ regex: /\bDocker\b/i, hint: "Docker" },
	{ regex: /\bKubernetes\b/i, hint: "Kubernetes" },
	{ regex: /\bGitHub\s+Actions\b/i, hint: "GitHub Actions" },
	{ regex: /\bGitLab\s+CI\b/i, hint: "GitLab CI" },
	{ regex: /\bTailwind\b/i, hint: "Tailwind CSS" },
	{ regex: /\bshadcn(\/ui)?\b/i, hint: "shadcn/ui" },
	{ regex: /\bMaterial[\s-]?UI\b|\bMUI\b/i, hint: "Material UI" },
	{ regex: /\bPrisma\b/i, hint: "Prisma" },
	{ regex: /\bDrizzle\b/i, hint: "Drizzle" },
	{ regex: /\bEloquent\b/i, hint: "Eloquent (Laravel)" },
]

const PROJECT_TYPE_PATTERNS: { regex: RegExp; type: string }[] = [
	{ regex: /\bmonorepo\b|\bmulti[-\s]?repo\b/i, type: "Monorepo (web + mobile + API)" },
	{ regex: /\bmobile\s+app\b|\bmobile\s+application\b|\biOS\b|\bAndroid\b|\bFlutter\b|\bReact\s+Native\b/i, type: "Mobile app" },
	{ regex: /\bAPI\s+(server|service)\b|\bbackend\s+service\b|\bREST\s+API\b/i, type: "API / backend service" },
	{ regex: /\bSPA\b|\bsingle[-\s]?page\s+app\b/i, type: "Single-page web app (frontend only)" },
	{ regex: /\bCLI\s+tool\b|\bcommand[-\s]?line\b/i, type: "Command-line tool" },
	{ regex: /\blibrary\b|\bpackage\b|\bSDK\b/i, type: "Library / package" },
	{ regex: /\bdesktop\s+app\b|\bElectron\b|\bTauri\b/i, type: "Desktop app" },
	{ regex: /\bstatic\s+site\b|\bdocs\s+site\b/i, type: "Static site / docs" },
	// Default catch-all (lowest priority) — checked last
	{ regex: /\bweb\s+(app|application|platform)\b|\bplatform\b|\bdashboard\b/i, type: "Web application (full-stack)" },
]

// =============================================================================
// Public API
// =============================================================================

/**
 * Classify a markdown document as PRD-shaped, plan-shaped, or hybrid.
 * Returns a normalised confidence so the dashboard can decide whether to
 * ask the bridge for an LLM uplift.
 */
export function classifyMarkdown(md: string): ClassifyResult {
	const signals: string[] = []
	let planScore = 0
	let prdScore = 0

	for (const s of PLAN_SIGNALS) {
		if (s.pattern.test(md)) {
			planScore += s.weight
			signals.push(`plan:${s.label}`)
		}
	}
	for (const s of PRD_SIGNALS) {
		if (s.pattern.test(md)) {
			prdScore += s.weight
			signals.push(`prd:${s.label}`)
		}
	}

	// Cap the raw scores; they overflow on long docs hitting many signals.
	const planNorm = Math.min(1, planScore)
	const prdNorm = Math.min(1, prdScore)

	let kind: InterpretedKind
	let confidence: number
	if (planNorm < 0.15 && prdNorm < 0.15) {
		kind = "unknown"
		confidence = Math.max(planNorm, prdNorm)
	} else if (planNorm > 0 && prdNorm > 0 && Math.abs(planNorm - prdNorm) < 0.2) {
		kind = "hybrid"
		confidence = Math.min(1, (planNorm + prdNorm) / 2)
	} else if (planNorm > prdNorm) {
		kind = "plan"
		confidence = planNorm
	} else {
		kind = "prd"
		confidence = prdNorm
	}

	return { kind, signals, confidence }
}

/** Best-effort field extraction. */
export function extractFields(md: string): InterpretedPrd {
	const sections = sliceSections(md)

	return {
		projectName: extractProjectName(md),
		projectType: extractProjectType(md, sections),
		summary: extractSummary(md, sections),
		dataModel: extractByHeadings(sections, [
			/data\s+model/i,
			/entit(y|ies)/i,
			/schema/i,
			/database\s+(design|schema)/i,
		]),
		constraints: extractByHeadings(sections, [
			/constraints?/i,
			/requirements?/i,
			/non[-\s]?functional\s+requirements?/i,
			/limitations?/i,
		]),
		successCriteria: extractByHeadings(sections, [
			/success\s+(criteria|metrics)/i,
			/acceptance\s+(criteria)?/i,
			/definition\s+of\s+done/i,
			/key\s+results?\b/i,
		]),
		stackHints: extractStackHints(md),
		originalSections: sections,
	}
}

/**
 * When the LLM-backed interpret path is invoked, its output is merged on top
 * of the heuristic baseline. Higher-confidence wins per field; both
 * confidences are blended into the average.
 */
export function mergeWithLlmInterpretation(
	local: InterpretedPrd,
	llm: Partial<InterpretedPrd>,
): InterpretedPrd {
	const merged: InterpretedPrd = { ...local }
	const fields: (keyof InterpretedPrd)[] = [
		"projectName",
		"projectType",
		"summary",
		"dataModel",
		"constraints",
		"successCriteria",
	]
	for (const f of fields) {
		const localF = local[f] as FieldWithConfidence
		const llmF = llm[f] as FieldWithConfidence | undefined
		if (!llmF || !llmF.value) continue
		if (localF.confidence < llmF.confidence) {
			;(merged[f] as FieldWithConfidence) = { value: String(llmF.value), confidence: llmF.confidence }
		}
	}
	if (llm.stackHints && Array.isArray(llm.stackHints.value)) {
		const combined = new Set([...local.stackHints.value, ...llm.stackHints.value])
		merged.stackHints = {
			value: Array.from(combined),
			confidence: Math.max(local.stackHints.confidence, llm.stackHints.confidence),
		}
	}
	return merged
}

// =============================================================================
// Internals
// =============================================================================

function sliceSections(md: string): { heading: string; level: number; body: string }[] {
	const lines = md.split(/\r?\n/)
	const sections: { heading: string; level: number; body: string }[] = []
	let current: { heading: string; level: number; bodyLines: string[] } | null = null
	for (const line of lines) {
		const m = line.match(/^(#{1,6})\s+(.+?)\s*$/)
		if (m) {
			if (current) {
				sections.push({ heading: current.heading, level: current.level, body: current.bodyLines.join("\n").trim() })
			}
			current = { heading: m[2].trim(), level: m[1].length, bodyLines: [] }
		} else {
			if (current) current.bodyLines.push(line)
			else {
				// Pre-heading content goes into a synthetic "_preamble" section
				const last = sections[sections.length - 1]
				if (!last || last.heading !== "_preamble") {
					sections.push({ heading: "_preamble", level: 0, body: line })
				} else {
					last.body = (last.body + "\n" + line).trim()
				}
			}
		}
	}
	if (current) {
		sections.push({ heading: current.heading, level: current.level, body: current.bodyLines.join("\n").trim() })
	}
	return sections
}

function extractProjectName(md: string): FieldWithConfidence<string> {
	// First H1 wins.
	const h1 = md.match(/^#\s+(.+?)\s*$/m)
	if (h1) {
		// Strip parenthetical document-type suffix like "(PRD)" or "Product Requirements Document"
		let name = h1[1].replace(/\s*[—\-:]\s*Product\s+Requirements\s+Document\s*$/i, "")
		name = name.replace(/\s*\((PRD|Plan)\)\s*$/i, "")
		name = name.replace(/\s*[—\-]\s*PRD\s*$/i, "")
		return { value: name.trim(), confidence: 0.85 }
	}
	return { value: "", confidence: 0 }
}

function extractProjectType(
	md: string,
	_sections: { heading: string; level: number; body: string }[],
): FieldWithConfidence<string> {
	for (const p of PROJECT_TYPE_PATTERNS) {
		if (p.regex.test(md)) return { value: p.type, confidence: 0.7 }
	}
	return { value: "", confidence: 0 }
}

function extractSummary(
	md: string,
	sections: { heading: string; level: number; body: string }[],
): FieldWithConfidence<string> {
	// 1. Prefer a section explicitly labelled summary / executive summary / vision / overview.
	const labelled = extractByHeadings(sections, [
		/executive\s+summary/i,
		/^summary$/i,
		/^overview$/i,
		/product\s+vision/i,
		/^vision$/i,
		/description/i,
	])
	if (labelled.value) return labelled
	// 2. Fallback: first non-empty paragraph in the document, after the H1.
	const lines = md.split(/\r?\n/)
	let pastH1 = false
	const para: string[] = []
	for (const line of lines) {
		if (!pastH1) {
			if (/^#\s+/.test(line)) pastH1 = true
			continue
		}
		if (/^#{1,6}\s+/.test(line)) {
			if (para.length > 0) break
			continue
		}
		const trimmed = line.trim()
		if (trimmed.length === 0) {
			if (para.length > 0) break
			continue
		}
		// Skip metadata lines like **Version:** 1.0
		if (/^\*\*[A-Za-z\s]+:\*\*\s/.test(trimmed)) continue
		para.push(trimmed)
		if (para.join(" ").length > 300) break
	}
	const summary = para.join(" ").trim()
	if (summary.length >= 30) return { value: summary, confidence: 0.65 }
	if (summary.length > 0) return { value: summary, confidence: 0.4 }
	return { value: "", confidence: 0 }
}

function extractByHeadings(
	sections: { heading: string; level: number; body: string }[],
	patterns: RegExp[],
): FieldWithConfidence<string> {
	for (const sec of sections) {
		for (const p of patterns) {
			if (p.test(sec.heading)) {
				const body = sec.body.trim()
				if (body.length > 0) {
					// First heading match wins.
					return { value: body, confidence: 0.8 }
				}
			}
		}
	}
	return { value: "", confidence: 0 }
}

function extractStackHints(md: string): FieldWithConfidence<string[]> {
	const found = new Set<string>()
	for (const k of STACK_KEYWORDS) {
		if (k.regex.test(md)) found.add(k.hint)
	}
	if (found.size === 0) return { value: [], confidence: 0 }
	return { value: Array.from(found), confidence: Math.min(1, 0.4 + found.size * 0.1) }
}

/** Convenience: combined classify + extract for the dashboard endpoint. */
export function interpret(md: string): {
	classification: ClassifyResult
	fields: InterpretedPrd
	confidence: number
} {
	const classification = classifyMarkdown(md)
	const fields = extractFields(md)
	// Aggregate confidence: classification * average field confidence.
	const fieldConfidences = [
		fields.projectName.confidence,
		fields.summary.confidence,
		fields.successCriteria.confidence,
	]
	const avgFieldConf = fieldConfidences.reduce((a, b) => a + b, 0) / fieldConfidences.length
	return {
		classification,
		fields,
		confidence: Math.min(1, classification.confidence * 0.5 + avgFieldConf * 0.5),
	}
}
