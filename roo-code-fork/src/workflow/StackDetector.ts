/**
 * StackDetector.ts — Universal Technology Stack Auto-Detection
 *
 * Scans the workspace to automatically detect:
 * - Programming languages
 * - Frameworks (frontend, backend, mobile, desktop)
 * - Databases
 * - Build tools & package managers
 * - Architecture patterns (monorepo, microservices, monolith)
 * - DevOps/CI tools
 * - Testing frameworks
 *
 * The detected stack is used by WorkflowEngine to generate
 * context-aware prompts and evaluation criteria.
 */

import * as fs from "fs"
import * as path from "path"

// ============================================================================
// TYPES
// ============================================================================

export interface DetectedStack {
    languages: string[]
    frameworks: FrameworkInfo[]
    databases: string[]
    buildTools: string[]
    packageManagers: string[]
    architecture: string          // monolith | monorepo | microservices | serverless | hybrid
    platforms: string[]           // web | mobile | desktop | api | cli | embedded
    testing: string[]
    devops: string[]
    styling: string[]
    stateManagement: string[]
    orm: string[]
    summary: string               // Human-readable summary
    confidence: number            // 0-100
    detectedAt: string
}

export interface FrameworkInfo {
    name: string
    category: "frontend" | "backend" | "fullstack" | "mobile" | "desktop" | "ml" | "game" | "other"
    version?: string
}

// ============================================================================
// DETECTION SIGNATURES
// ============================================================================

interface FileSignature {
    files: string[]           // Files to look for
    name: string
    category: string
}

const LANG_SIGNATURES: Record<string, string[]> = {
    TypeScript: ["tsconfig.json", "*.ts", "*.tsx"],
    JavaScript: ["*.js", "*.jsx", "*.mjs"],
    Python: ["*.py", "requirements.txt", "setup.py", "pyproject.toml", "Pipfile"],
    Java: ["*.java", "pom.xml", "build.gradle"],
    Kotlin: ["*.kt", "*.kts"],
    Swift: ["*.swift", "Package.swift"],
    "C#": ["*.cs", "*.csproj", "*.sln"],
    Go: ["go.mod", "go.sum", "*.go"],
    Rust: ["Cargo.toml", "*.rs"],
    Ruby: ["Gemfile", "*.rb", "Rakefile"],
    PHP: ["composer.json", "*.php"],
    Dart: ["pubspec.yaml", "*.dart"],
    Elixir: ["mix.exs", "*.ex", "*.exs"],
    Scala: ["build.sbt", "*.scala"],
    "C/C++": ["CMakeLists.txt", "Makefile", "*.c", "*.cpp", "*.h"],
    Lua: ["*.lua"],
    R: ["*.R", "*.Rmd", "DESCRIPTION"],
    Julia: ["Project.toml", "*.jl"],
    Haskell: ["*.hs", "stack.yaml", "*.cabal"],
    Zig: ["build.zig", "*.zig"],
}

const FRAMEWORK_SIGNATURES: FileSignature[] = [
    // Frontend
    { files: ["next.config.js", "next.config.mjs", "next.config.ts"], name: "Next.js", category: "fullstack" },
    { files: ["nuxt.config.ts", "nuxt.config.js"], name: "Nuxt", category: "fullstack" },
    { files: ["svelte.config.js"], name: "SvelteKit", category: "fullstack" },
    { files: ["astro.config.mjs"], name: "Astro", category: "frontend" },
    { files: ["remix.config.js"], name: "Remix", category: "fullstack" },
    { files: ["angular.json"], name: "Angular", category: "frontend" },
    { files: ["vite.config.ts", "vite.config.js"], name: "Vite", category: "frontend" },
    { files: ["gatsby-config.js"], name: "Gatsby", category: "frontend" },
    { files: ["ember-cli-build.js"], name: "Ember", category: "frontend" },
    // Backend
    { files: ["artisan", "composer.json"], name: "Laravel", category: "backend" },
    { files: ["manage.py", "django"], name: "Django", category: "backend" },
    { files: ["app.py", "wsgi.py"], name: "Flask", category: "backend" },
    { files: ["fastapi"], name: "FastAPI", category: "backend" },
    { files: ["Gemfile"], name: "Rails", category: "backend" },
    { files: ["pom.xml"], name: "Spring", category: "backend" },
    { files: ["build.gradle.kts"], name: "Spring Boot (Kotlin)", category: "backend" },
    { files: ["Program.cs", "Startup.cs"], name: "ASP.NET", category: "backend" },
    { files: ["main.go", "go.mod"], name: "Go (net/http/gin/fiber)", category: "backend" },
    { files: ["mix.exs"], name: "Phoenix", category: "backend" },
    { files: ["nest-cli.json"], name: "NestJS", category: "backend" },
    { files: ["strapi"], name: "Strapi", category: "backend" },
    { files: ["payload.config.ts"], name: "Payload CMS", category: "backend" },
    // Mobile
    { files: ["pubspec.yaml"], name: "Flutter", category: "mobile" },
    { files: ["app.json", "expo"], name: "React Native / Expo", category: "mobile" },
    { files: ["capacitor.config.ts"], name: "Capacitor (Ionic)", category: "mobile" },
    { files: ["AndroidManifest.xml"], name: "Android Native", category: "mobile" },
    { files: ["Info.plist", "*.xcodeproj"], name: "iOS Native", category: "mobile" },
    { files: [".swiftpm"], name: "SwiftUI", category: "mobile" },
    { files: ["maui"], name: ".NET MAUI", category: "mobile" },
    // Desktop
    { files: ["electron-builder.yml", "electron.js"], name: "Electron", category: "desktop" },
    { files: ["tauri.conf.json"], name: "Tauri", category: "desktop" },
    { files: ["wails.json"], name: "Wails", category: "desktop" },
    // ML/AI
    { files: ["model.py", "train.py"], name: "PyTorch/TF", category: "ml" },
    { files: ["notebook"], name: "Jupyter", category: "ml" },
    // Game
    { files: ["ProjectSettings"], name: "Unity", category: "game" },
    { files: ["project.godot"], name: "Godot", category: "game" },
]

const DB_SIGNATURES: Record<string, string[]> = {
    PostgreSQL: ["pg", "postgres", "postgresql"],
    MySQL: ["mysql", "mariadb"],
    MongoDB: ["mongodb", "mongoose"],
    SQLite: ["sqlite", "sqlite3"],
    Redis: ["redis", "ioredis"],
    Supabase: ["supabase"],
    Firebase: ["firebase", "firestore"],
    PlanetScale: ["planetscale"],
    DynamoDB: ["dynamodb", "aws-sdk"],
    Prisma: ["prisma"],
    Drizzle: ["drizzle-orm"],
    TypeORM: ["typeorm"],
    Sequelize: ["sequelize"],
    Mongoose: ["mongoose"],
    Knex: ["knex"],
    "SQL Server": ["mssql", "tedious"],
    CockroachDB: ["cockroachdb"],
    Neo4j: ["neo4j"],
    Elasticsearch: ["elasticsearch", "@elastic"],
    InfluxDB: ["influxdb"],
}

const DEVOPS_SIGNATURES: Record<string, string[]> = {
    Docker: ["Dockerfile", "docker-compose.yml", "docker-compose.yaml"],
    Kubernetes: ["k8s", "kubernetes", "*.yaml"],
    "GitHub Actions": [".github/workflows"],
    "GitLab CI": [".gitlab-ci.yml"],
    Terraform: ["*.tf", "terraform"],
    Vercel: ["vercel.json"],
    Netlify: ["netlify.toml"],
    AWS: ["serverless.yml", "sam", "cdk"],
    "Google Cloud": ["app.yaml", "cloudbuild.yaml"],
    Azure: ["azure-pipelines.yml"],
    Nginx: ["nginx.conf"],
    PM2: ["ecosystem.config.js"],
}

const TESTING_SIGNATURES: Record<string, string[]> = {
    Jest: ["jest.config"],
    Vitest: ["vitest.config"],
    Mocha: ["mocha", ".mocharc"],
    Cypress: ["cypress.config"],
    Playwright: ["playwright.config"],
    PyTest: ["pytest", "conftest.py"],
    PHPUnit: ["phpunit"],
    JUnit: ["junit"],
    RSpec: ["spec"],
    "Go Test": ["_test.go"],
    XCTest: ["XCTest"],
}

// ============================================================================
// DETECTOR CLASS
// ============================================================================

export class StackDetector {
    private root: string

    constructor(workspaceRoot: string) {
        this.root = workspaceRoot
    }

    detect(): DetectedStack {
        const result: DetectedStack = {
            languages: [],
            frameworks: [],
            databases: [],
            buildTools: [],
            packageManagers: [],
            architecture: "monolith",
            platforms: [],
            testing: [],
            devops: [],
            styling: [],
            stateManagement: [],
            orm: [],
            summary: "",
            confidence: 0,
            detectedAt: new Date().toISOString(),
        }

        // Detect languages
        result.languages = this.detectLanguages()

        // Detect frameworks
        result.frameworks = this.detectFrameworks()

        // Detect from package files
        this.detectFromPackageFiles(result)

        // Detect architecture
        result.architecture = this.detectArchitecture()

        // Detect platforms
        result.platforms = this.detectPlatforms(result)

        // Detect DevOps
        result.devops = this.detectDevOps()

        // Detect testing
        result.testing = this.detectTesting()

        // Generate summary
        result.summary = this.generateSummary(result)
        result.confidence = this.calculateConfidence(result)

        return result
    }

    private detectLanguages(): string[] {
        const found: string[] = []
        for (const [lang, patterns] of Object.entries(LANG_SIGNATURES)) {
            for (const pattern of patterns) {
                if (pattern.startsWith("*")) {
                    // Extension search — check if any file with this extension exists (top 2 levels)
                    const ext = pattern.substring(1)
                    if (this.hasFileWithExtension(ext, 2)) {
                        found.push(lang)
                        break
                    }
                } else {
                    if (this.fileExists(pattern)) {
                        found.push(lang)
                        break
                    }
                }
            }
        }
        return [...new Set(found)]
    }

    private detectFrameworks(): FrameworkInfo[] {
        const found: FrameworkInfo[] = []
        for (const sig of FRAMEWORK_SIGNATURES) {
            for (const file of sig.files) {
                if (this.fileExists(file) || this.hasFileInSubdirs(file, 1)) {
                    found.push({
                        name: sig.name,
                        category: sig.category as FrameworkInfo["category"],
                    })
                    break
                }
            }
        }

        // Check package.json for React/Vue/Svelte
        const pkgJson = this.readPackageJson()
        if (pkgJson) {
            const allDeps = { ...pkgJson.dependencies, ...pkgJson.devDependencies }
            if (allDeps["react"]) found.push({ name: "React", category: "frontend" })
            if (allDeps["vue"]) found.push({ name: "Vue", category: "frontend" })
            if (allDeps["svelte"]) found.push({ name: "Svelte", category: "frontend" })
            if (allDeps["express"]) found.push({ name: "Express", category: "backend" })
            if (allDeps["fastify"]) found.push({ name: "Fastify", category: "backend" })
            if (allDeps["hono"]) found.push({ name: "Hono", category: "backend" })
            if (allDeps["koa"]) found.push({ name: "Koa", category: "backend" })
            if (allDeps["three"]) found.push({ name: "Three.js", category: "frontend" })
        }

        // Deduplicate by name
        const seen = new Set<string>()
        return found.filter((f) => {
            if (seen.has(f.name)) return false
            seen.add(f.name)
            return true
        })
    }

    private detectFromPackageFiles(result: DetectedStack): void {
        // npm/yarn/pnpm
        if (this.fileExists("package.json")) {
            result.packageManagers.push(
                this.fileExists("pnpm-lock.yaml") ? "pnpm" :
                this.fileExists("yarn.lock") ? "yarn" : "npm"
            )
            const pkg = this.readPackageJson()
            if (pkg) {
                const allDeps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
                // Databases
                for (const [db, keywords] of Object.entries(DB_SIGNATURES)) {
                    if (allDeps.some((d) => keywords.some((kw) => d.includes(kw)))) {
                        result.databases.push(db)
                    }
                }
                // Styling
                if (allDeps.includes("tailwindcss")) result.styling.push("Tailwind CSS")
                if (allDeps.includes("styled-components")) result.styling.push("Styled Components")
                if (allDeps.includes("@emotion/react")) result.styling.push("Emotion")
                if (allDeps.includes("sass")) result.styling.push("Sass")
                if (allDeps.includes("@chakra-ui/react")) result.styling.push("Chakra UI")
                if (allDeps.includes("@mui/material")) result.styling.push("MUI")
                if (allDeps.includes("antd")) result.styling.push("Ant Design")
                // State management
                if (allDeps.includes("redux") || allDeps.includes("@reduxjs/toolkit")) result.stateManagement.push("Redux")
                if (allDeps.includes("zustand")) result.stateManagement.push("Zustand")
                if (allDeps.includes("mobx")) result.stateManagement.push("MobX")
                if (allDeps.includes("jotai")) result.stateManagement.push("Jotai")
                if (allDeps.includes("recoil")) result.stateManagement.push("Recoil")
                if (allDeps.includes("pinia")) result.stateManagement.push("Pinia")
                // Build tools
                if (allDeps.includes("webpack")) result.buildTools.push("Webpack")
                if (allDeps.includes("esbuild")) result.buildTools.push("esbuild")
                if (allDeps.includes("rollup")) result.buildTools.push("Rollup")
                if (allDeps.includes("turbo")) result.buildTools.push("Turborepo")
            }
        }

        // Python
        if (this.fileExists("requirements.txt") || this.fileExists("pyproject.toml")) {
            result.packageManagers.push(this.fileExists("Pipfile") ? "pipenv" : this.fileExists("pyproject.toml") ? "poetry/pip" : "pip")
        }
        // PHP
        if (this.fileExists("composer.json")) result.packageManagers.push("composer")
        // Ruby
        if (this.fileExists("Gemfile")) result.packageManagers.push("bundler")
        // Go
        if (this.fileExists("go.mod")) result.packageManagers.push("go modules")
        // Rust
        if (this.fileExists("Cargo.toml")) result.packageManagers.push("cargo")
        // Dart
        if (this.fileExists("pubspec.yaml")) result.packageManagers.push("pub")
        // Java
        if (this.fileExists("pom.xml")) result.buildTools.push("Maven")
        if (this.fileExists("build.gradle") || this.fileExists("build.gradle.kts")) result.buildTools.push("Gradle")

        result.databases = [...new Set(result.databases)]
    }

    private detectArchitecture(): string {
        // Monorepo indicators
        if (this.fileExists("pnpm-workspace.yaml") || this.fileExists("lerna.json") || this.fileExists("nx.json") || this.fileExists("turbo.json")) {
            return "monorepo"
        }
        const pkg = this.readPackageJson()
        if (pkg?.workspaces) return "monorepo"

        // Microservices
        if (this.fileExists("docker-compose.yml") || this.fileExists("docker-compose.yaml")) {
            try {
                const compose = fs.readFileSync(path.join(this.root, "docker-compose.yml"), "utf-8")
                const serviceCount = (compose.match(/^\s{2}\w+:/gm) || []).length
                if (serviceCount >= 3) return "microservices"
            } catch {}
        }

        // Serverless
        if (this.fileExists("serverless.yml") || this.fileExists("netlify.toml") || this.fileExists("vercel.json")) {
            return "serverless"
        }

        return "monolith"
    }

    private detectPlatforms(result: DetectedStack): string[] {
        const platforms: string[] = []
        const cats = result.frameworks.map((f) => f.category)
        if (cats.includes("frontend") || cats.includes("fullstack")) platforms.push("web")
        if (cats.includes("mobile")) platforms.push("mobile")
        if (cats.includes("desktop")) platforms.push("desktop")
        if (cats.includes("backend")) platforms.push("api")
        if (cats.includes("ml")) platforms.push("ml")
        if (platforms.length === 0) platforms.push("web") // Default
        return [...new Set(platforms)]
    }

    private detectDevOps(): string[] {
        const found: string[] = []
        for (const [tool, patterns] of Object.entries(DEVOPS_SIGNATURES)) {
            for (const p of patterns) {
                if (this.fileExists(p) || this.dirExists(p)) {
                    found.push(tool)
                    break
                }
            }
        }
        return found
    }

    private detectTesting(): string[] {
        const found: string[] = []
        for (const [tool, patterns] of Object.entries(TESTING_SIGNATURES)) {
            for (const p of patterns) {
                if (p.endsWith(".go") || p.endsWith(".py")) {
                    if (this.hasFileWithExtension(p, 2)) { found.push(tool); break }
                } else {
                    if (this.fileExists(p) || this.hasFileContaining(p)) { found.push(tool); break }
                }
            }
        }
        return found
    }

    private generateSummary(s: DetectedStack): string {
        const parts: string[] = []
        if (s.architecture !== "monolith") parts.push(`${s.architecture} architecture`)
        if (s.languages.length) parts.push(`Languages: ${s.languages.join(", ")}`)
        if (s.frameworks.length) parts.push(`Frameworks: ${s.frameworks.map((f) => f.name).join(", ")}`)
        if (s.databases.length) parts.push(`DB: ${s.databases.join(", ")}`)
        if (s.platforms.length) parts.push(`Platforms: ${s.platforms.join(", ")}`)
        return parts.join(" | ") || "Unknown stack"
    }

    private calculateConfidence(s: DetectedStack): number {
        let score = 0
        if (s.languages.length > 0) score += 30
        if (s.frameworks.length > 0) score += 30
        if (s.packageManagers.length > 0) score += 15
        if (s.databases.length > 0) score += 10
        if (s.devops.length > 0) score += 10
        if (s.testing.length > 0) score += 5
        return Math.min(score, 100)
    }

    // ========================================================================
    // FILE SYSTEM HELPERS
    // ========================================================================

    private fileExists(name: string): boolean {
        try { return fs.existsSync(path.join(this.root, name)) } catch { return false }
    }

    private dirExists(name: string): boolean {
        try {
            const p = path.join(this.root, name)
            return fs.existsSync(p) && fs.statSync(p).isDirectory()
        } catch { return false }
    }

    private hasFileWithExtension(ext: string, depth: number): boolean {
        return this.searchFiles(this.root, ext, depth)
    }

    private searchFiles(dir: string, ext: string, depth: number): boolean {
        if (depth < 0) return false
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true })
            for (const entry of entries) {
                if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "vendor" || entry.name === "dist" || entry.name === "build") continue
                if (entry.isFile() && entry.name.endsWith(ext)) return true
                if (entry.isDirectory() && depth > 0) {
                    if (this.searchFiles(path.join(dir, entry.name), ext, depth - 1)) return true
                }
            }
        } catch {}
        return false
    }

    private hasFileInSubdirs(name: string, depth: number): boolean {
        return this.searchFileByName(this.root, name, depth)
    }

    private searchFileByName(dir: string, name: string, depth: number): boolean {
        if (depth < 0) return false
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true })
            for (const entry of entries) {
                if (entry.name.startsWith(".") || entry.name === "node_modules") continue
                if (entry.isFile() && entry.name === name) return true
                if (entry.isDirectory() && depth > 0) {
                    if (this.searchFileByName(path.join(dir, entry.name), name, depth - 1)) return true
                }
            }
        } catch {}
        return false
    }

    private hasFileContaining(keyword: string): boolean {
        try {
            const entries = fs.readdirSync(this.root)
            return entries.some((e) => e.toLowerCase().includes(keyword.toLowerCase()))
        } catch { return false }
    }

    private readPackageJson(): any {
        try {
            const p = path.join(this.root, "package.json")
            if (!fs.existsSync(p)) return null
            return JSON.parse(fs.readFileSync(p, "utf-8"))
        } catch { return null }
    }
}
