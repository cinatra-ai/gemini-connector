# Coding Conventions

**Analysis Date:** 2026-06-09

## Naming Patterns

**Files:**
- `kebab-case` for all source files: `log-directory.ts`, `save-gemini-form.tsx`, `sync-and-readback.test.ts`
- Test files live in `src/__tests__/` with `.test.ts` suffix
- UI components in `src/components/ui/` match their component name in kebab-case: `button.tsx`, `input.tsx`, `label.tsx`

**Functions:**
- `camelCase` for all functions: `getGeminiDeps`, `saveGeminiAPISettings`, `buildGeminiRequestHeaders`
- Verb-first naming: `get*`, `save*`, `build*`, `clear*`, `sync*`, `register*`, `write*`, `read*`
- Internal test-only helpers prefixed with underscore: `_resetGeminiDepsForTests`
- Private module helpers are unexported plain functions: `extractApiKey`, `sanitizeLogLabel`, `buildLogTimestamp`, `geminiNango`

**Variables/Constants:**
- `SCREAMING_SNAKE_CASE` for module-level constants: `GEMINI_API_LOG_DIRECTORY`, `GEMINI_DEPS_KEY`, `SOURCE`, `GATE`, `APIKEY`
- `camelCase` for local variables and function parameters
- Boolean flags expressed as full phrases: `loggingEnabled`, `isConfigured`

**Types/Interfaces:**
- `PascalCase` for all exported types and interfaces: `GeminiAPISettings`, `GeminiConnectorDeps`, `GeminiNangoCapability`
- Interface names describe structural role, not implementation: `GeminiNangoCapability` (capability, not `GeminiNangoClient`)
- Zod schemas named with `Schema` suffix: `geminiConnectorSchema`

## Code Style

**Formatting:**
- No ESLint or Prettier config found in this repo — formatting is controlled by the parent monorepo toolchain
- 2-space indentation throughout
- Double quotes for strings in TypeScript source: `"use server"`, `"gemini"`, `"API_KEY"`
- Trailing commas in multi-line object/array literals
- `satisfies` keyword used for type-narrowing assignments without widening: `} satisfies GeminiAPISettings`, `} satisfies Record<string, string>`

**TypeScript:**
- `strict: true` in `tsconfig.json` but `noImplicitAny: false` relaxed
- `verbatimModuleSyntax: true` — use `import type` for type-only imports
- ESM-only (`"type": "module"` in `package.json`, `"module": "ESNext"`)
- `isolatedModules: true` — each file must be independently compilable

## Import Organization

**Order:**
1. Node built-ins with `node:` prefix: `import { mkdir, writeFile } from "node:fs/promises"`, `import path from "node:path"`
2. Third-party packages: `import { z } from "zod"`, `import { redirect } from "next/navigation"`
3. SDK peer dependencies: `import { requireExtensionAction } from "@cinatra-ai/sdk-extensions"`
4. Local relative imports: `import { GEMINI_API_LOG_DIRECTORY } from "./log-directory"`

**Path Aliases:**
- No `@/` alias defined within this package itself — `@/` aliases in `vitest.config.ts` resolve to the parent monorepo's `src/` directory via `path.join(repoRoot, "src")`

## Error Handling

**Patterns:**
- Throw `new Error(message)` with human-readable messages for user-visible errors: `throw new Error("Enter a Gemini API key to continue.")`
- Generic error messages for security-sensitive failures (never include token values in error text): `"Nango credential verification failed: the readback value did not match the saved credential."`
- In server actions: catch unknown errors and re-throw as `Error` with normalized message:
  ```typescript
  const message = error instanceof Error ? error.message : "Unable to save the Gemini API connection.";
  throw new Error(message);
  ```
- Null returns used for "not configured / not found" states rather than throwing: `getConfiguredGeminiAPIKey()` returns `null` when unconfigured
- Early returns guard pre-conditions: `if (!nango.isConfigured()) { return; }`

## Dependency Injection Pattern

- Host deps registered at boot via `registerGeminiConnector(deps)` in `src/deps.ts`
- Deps stored on `globalThis` via a namespaced versioned Symbol (`Symbol.for("@cinatra-ai/gemini-connector:host-deps/v1")`) to survive separately-compiled Next.js bundles
- `getGeminiDeps()` throws with a clear registration error if deps are not set
- `_resetGeminiDepsForTests()` exported (underscore-prefixed) for test cleanup
- No imports from host-internal `@/lib/*` paths or from sibling extensions — only SDK peer deps (`@cinatra-ai/sdk-extensions`)

## Comments

**When to Comment:**
- Module-level block comments explain architectural rationale: why globalThis is used, why connectorKey is omitted, what the readback-safe order is
- JSDoc (`/** */`) used for exported functions and interface members: `getGeminiDeps`, `registerGeminiConnector`, `GeminiNangoCapability` methods
- Inline comments mark non-obvious security constraints and order-dependency: `// Readback-safe order mirrors saveApifySettings:`
- Test files open with long block comment explaining the test's security rationale and what it replaces

**JSDoc/TSDoc:**
- JSDoc used selectively on public API exports in `src/deps.ts` and `src/index.ts`
- `@internal` tag used for test-only exports: `/** @internal test-only. */`

## Module Design

**Exports:**
- Named exports only — no default exports in `.ts` files
- `src/index.ts` is the package entry point; it re-exports from sub-modules with `export { ... } from "./deps"`
- UI components in `src/components/ui/` use named exports: `export { Button, buttonVariants }`

**Barrel Files:**
- `src/index.ts` acts as barrel for the package public API — aggregates `./log-directory`, `./deps`, and inline logic

## UI Component Style

- Components use `class-variance-authority` (`cva`) for variant management: `src/components/ui/button.tsx`
- `cn()` utility from `src/lib/utils.ts` used for all className merging (clsx + tailwind-merge)
- React components use destructured `React.ComponentProps<"button">` spread pattern; no separate prop interfaces unless needed
- `asChild` prop pattern with `Slot.Root` from radix-ui for composition

---

*Convention analysis: 2026-06-09*
