/**
 * ModelAdvisor — recommends a per-phase model routing config based on
 * detected stack, project size, and the user's budget tier.
 *
 * V6 Phase C. The advisor is opinionated: Director / Planner / reviewers
 * run on a small, fast model; the Executor runs on a large model. The
 * exact model id depends on which provider's catalog is available — the
 * advisor returns a list of *candidate* model ids per slot, and the
 * dashboard picks the first one the user actually has access to.
 *
 * Pure data + simple matching. No LLM call.
 */

export type BudgetTier = "budget" | "balanced" | "premium"

export interface ProjectSize {
	fileCount: number
	approxLoc: number
}

export interface RoutingConfig {
	director: { modelId: string; provider?: string; rationale?: string }
	planner: { modelId: string; provider?: string; rationale?: string }
	executor: { modelId: string; provider?: string; rationale?: string }
	reviewer: { modelId: string; provider?: string; rationale?: string }
	"workflow-master": { modelId: string; provider?: string; rationale?: string }
}

export interface ModelInfoLike {
	id: string
	name?: string
	provider?: string
}

/**
 * Preset routing matrix. The IDs are *intent labels* the dashboard
 * resolves against the actual model registry — e.g. `"small-fast"` →
 * `claude-haiku-4-5` if Anthropic, `gpt-4o-mini` if OpenAI, etc.
 *
 * Concrete model IDs ship as "preferred" candidates; the dashboard's
 * `validateRouting()` walks them in order and picks the first one the
 * user has credentials for.
 */
const PRESET_MATRIX: Record<BudgetTier, RoutingConfig> = {
	budget: {
		director:          { modelId: "small-fast",  rationale: "Director writes high-level plans (max 10 lines per phase). Cheap-fast model is sufficient." },
		planner:           { modelId: "small-fast",  rationale: "Planner enumerates files and steps. Cheap-fast is sufficient at this size." },
		executor:          { modelId: "mid-balanced", rationale: "Executor writes code; balanced model keeps cost moderate while handling typical complexity." },
		reviewer:          { modelId: "small-fast",  rationale: "Reviews are short; small model is plenty." },
		"workflow-master": { modelId: "mid-balanced", rationale: "Workflow Master shape-shifts; balanced model handles all roles acceptably." },
	},
	balanced: {
		director:          { modelId: "small-fast",   rationale: "Cheap-fast model handles planning prose well." },
		planner:           { modelId: "mid-balanced", rationale: "Planning needs accuracy on file lists; balanced model preferred." },
		executor:          { modelId: "large-smart",  rationale: "Executor writes real code; large model reduces retry rate." },
		reviewer:          { modelId: "small-fast",   rationale: "Reviewer reads small docs; small model is sufficient." },
		"workflow-master": { modelId: "large-smart",  rationale: "Workflow Master handles every phase including execution." },
	},
	premium: {
		director:          { modelId: "mid-balanced", rationale: "Stronger planning quality is worth the small cost increase." },
		planner:           { modelId: "large-smart",  rationale: "Premium accuracy on detailed plans + risk assessment." },
		executor:          { modelId: "large-smart",  rationale: "Best-in-class for code generation." },
		reviewer:          { modelId: "mid-balanced", rationale: "Higher-quality reviews catch more issues before execution retry loops." },
		"workflow-master": { modelId: "large-smart",  rationale: "Premium tier uses the strongest model end-to-end." },
	},
}

/**
 * Resolve an intent label like `"small-fast"` to a list of preferred
 * concrete model IDs, ranked by quality/preference.
 *
 * The dashboard walks this list and picks the first one the user has
 * credentials for via `/api/models/list`.
 */
export const INTENT_TO_CANDIDATES: Record<string, string[]> = {
	"small-fast": [
		"claude-haiku-4-5",
		"claude-3-5-haiku-20241022",
		"gpt-4o-mini",
		"gpt-5-nano",
		"gemini-2.0-flash",
		"deepseek-chat",
	],
	"mid-balanced": [
		"claude-sonnet-4-5",
		"claude-3-5-sonnet-20241022",
		"gpt-4o",
		"gpt-5-mini",
		"gemini-2.5-pro",
		"deepseek-v3",
	],
	"large-smart": [
		"claude-opus-4-5",
		"claude-opus-4-1",
		"claude-3-7-sonnet-20250219",
		"gpt-5",
		"gpt-4-turbo",
		"deepseek-v4-pro",
	],
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Pick a routing recommendation for the given context.
 *
 * @param stack    DetectedStack from StackDetector (used by the
 *                 advisor only for size heuristics today; future versions
 *                 will use it for stack-aware model preferences).
 * @param size     fileCount + approximate LOC; bumps tier up for very large projects
 * @param tier     user's chosen tier
 */
export function recommendRouting(
	_stack: { confidence?: number; languages?: string[] } | null | undefined,
	size: ProjectSize | null | undefined,
	tier: BudgetTier = "balanced",
): RoutingConfig {
	let effectiveTier: BudgetTier = tier
	// Heuristic: very large projects bump one tier up unless already at premium.
	if (size && size.approxLoc > 200_000 && tier === "budget") effectiveTier = "balanced"
	if (size && size.approxLoc > 500_000 && tier === "balanced") effectiveTier = "premium"

	// Deep-clone so callers can mutate without poisoning the preset matrix.
	const preset = PRESET_MATRIX[effectiveTier]
	const cloned: RoutingConfig = {
		director:          { ...preset.director },
		planner:           { ...preset.planner },
		executor:          { ...preset.executor },
		reviewer:          { ...preset.reviewer },
		"workflow-master": { ...preset["workflow-master"] },
	}
	return cloned
}

/**
 * Resolve intent labels to concrete model IDs using the user's available
 * model registry. Returns the first candidate the user has access to.
 *
 * If no candidate matches, returns `null` — the caller should leave that
 * mode's override empty (which falls back to the user's globally
 * selected model).
 */
export function resolveIntentToConcrete(
	intent: string,
	available: ModelInfoLike[],
): { modelId: string; provider?: string } | null {
	const candidates = INTENT_TO_CANDIDATES[intent]
	if (!candidates) {
		// Already a concrete id; check availability.
		const m = available.find((x) => x.id === intent)
		return m ? { modelId: m.id, provider: m.provider } : null
	}
	for (const candidateId of candidates) {
		const m = available.find((x) => x.id === candidateId)
		if (m) return { modelId: m.id, provider: m.provider }
	}
	return null
}

/**
 * Validate a routing config against the user's available models.
 * Returns `{ valid, missing }`. `missing` lists modes whose configured
 * model isn't in the registry.
 */
export function validateRouting(
	routing: Partial<RoutingConfig>,
	available: ModelInfoLike[],
): { valid: boolean; missing: string[] } {
	const missing: string[] = []
	const modes: (keyof RoutingConfig)[] = ["director", "planner", "executor", "reviewer", "workflow-master"]
	for (const m of modes) {
		const entry = routing[m]
		if (!entry || !entry.modelId) continue // empty = fall back to global default; not "missing"
		// Intent labels are valid by construction — they get resolved later.
		if (entry.modelId in INTENT_TO_CANDIDATES) continue
		// Concrete id — must exist in the registry.
		if (!available.some((x) => x.id === entry.modelId)) missing.push(m)
	}
	return { valid: missing.length === 0, missing }
}

/**
 * Resolve every intent label in a routing config to a concrete model id.
 * Invoked by the dashboard right before persisting to workflow-config.json.
 */
export function materializeRouting(
	routing: RoutingConfig,
	available: ModelInfoLike[],
): RoutingConfig {
	const out = JSON.parse(JSON.stringify(routing)) as RoutingConfig
	const modes: (keyof RoutingConfig)[] = ["director", "planner", "executor", "reviewer", "workflow-master"]
	for (const m of modes) {
		const entry = out[m]
		if (!entry || !entry.modelId) continue
		if (entry.modelId in INTENT_TO_CANDIDATES) {
			const resolved = resolveIntentToConcrete(entry.modelId, available)
			if (resolved) {
				out[m] = { ...entry, modelId: resolved.modelId, provider: resolved.provider }
			} else {
				// Leave the intent label so the dashboard can show "no compatible model" for that slot.
			}
		}
	}
	return out
}
