# Roo Code Workflow — Configuration

## Configuration File

All workflow behavior can be customized via `WORKFLOW/workflow-config.json`:

```json
{
  "tokenBudgets": {
    "director": 4000,
    "planner": 8000,
    "executor": 32000,
    "workflow-master": 32000
  },
  "contextSizeLimits": {
    "maxFileSizeBytes": 51200,
    "maxContextTotalBytes": 524288
  },
  "pollingRateMs": 1000,
  "autopilotSettings": {
    "allowFullAutonomy": false
  }
}
```

### Token Budgets
Controls max tokens per mode. Lower budgets for Director (concise plans) and higher for Executor (code generation).

### Context Size Limits
- `maxFileSizeBytes` — Files larger than this are truncated when injected into context
- `maxContextTotalBytes` — Total context budget across all injected files

### Polling Rate
How frequently (ms) the status bar and file watcher check for state changes.

## Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `ROO_WEBHOOK_URL` | Slack/Discord webhook for notifications | `https://hooks.slack.com/...` |

## Quality Gate Strictness

Set `gateStrictness` in the config:
- `"hard"` — Blocks transition if gate fails (default)
- `"soft"` — Warns but allows transition

## Stack Detection

The `StackDetector` auto-detects your project's technology stack. Detection happens once during extension activation and can be re-triggered via the Bridge API:

```
POST http://localhost:3001/engine/stack/rescan
```

### Supported Stacks
| Category | Technologies |
|----------|-------------|
| Languages | TypeScript, JavaScript, Python, Java, Kotlin, Swift, C#, Go, Rust, Ruby, PHP, Dart, Elixir, Scala, C/C++, and more |
| Frameworks | Next.js, Nuxt, Angular, React, Vue, Laravel, Django, Flask, FastAPI, Rails, Spring, NestJS, Flutter, React Native, Electron, Tauri |
| Databases | PostgreSQL, MySQL, MongoDB, SQLite, Redis, Supabase, Firebase, DynamoDB, Prisma, Drizzle |
| Architecture | Monolith, Monorepo, Microservices, Serverless |

## Context Injection

Per-mode context files are configured in `workflow-config.json` under `contextFiles`. These files are automatically injected into the agent's system prompt when a mode switch occurs.
