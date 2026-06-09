# Technology Stack

**Analysis Date:** 2026-06-09

## Languages

**Primary:**
- TypeScript (strict mode, ES2023 target) - All source and test files under `src/`

**Secondary:**
- TSX (React JSX) - UI components in `src/components/ui/` and `src/setup-page.tsx`, `src/save-gemini-form.tsx`

## Runtime

**Environment:**
- Node.js (ESM-only, `"type": "module"` in `package.json`)
- Targets: Next.js server environment (server actions via `"use server"` directive in `src/actions.ts`)

**Package Manager:**
- npm (`.npmrc` present — note existence only, contents not read)
- Lockfile: Not detected in repo root (likely managed by parent monorepo or host app)

## Frameworks

**Core:**
- React 19 (peer dependency `^19.2.3`) - UI components and setup page
- Next.js (implicit — `redirect` from `next/navigation` in `src/actions.ts`, `"use server"` directive)

**Testing:**
- Vitest - Unit/integration tests; config at `vitest.config.ts`

**Build/Dev:**
- TypeScript compiler (`tsc`) - Config at `tsconfig.json`; outputs to `dist/`, `outDir: "dist"`

## Key Dependencies

**Critical:**
- `@cinatra-ai/sdk-extensions` (peer, optional) - Provides `requireExtensionAction`, `HostRequiredPackageDefinition`; the primary SDK surface consumed by this connector
- `@cinatra-ai/sdk-ui` (peer, optional) - UI primitives from the Cinatra SDK
- `zod` (^3.x, via `src/actions.ts` import) - Runtime schema validation for form data

**UI Utilities:**
- `class-variance-authority` `^0.7.1` - Variant-based class construction for components
- `clsx` `^2.1.1` - Conditional className joining
- `radix-ui` `^1.4.3` - Accessible UI primitives (used by button/input/label components)
- `tailwind-merge` `^3.5.0` - Tailwind class deduplication

## Configuration

**Environment:**
- `.npmrc` present — scoped registry or token config; never read
- No `.env` files detected
- Log output directory resolved at runtime: `data/logs/gemini-api` relative to `process.cwd()` (see `src/log-directory.ts`)

**Build:**
- `tsconfig.json` - Standalone (no `extends`), targets ES2023, `moduleResolution: "bundler"`, JSX transform `react-jsx`, emits declarations and source maps to `dist/`
- `vitest.config.ts` - Test environment `node`, aliases for `server-only` and `@/lib/database` stubs (points to stubs in a parent repo's `tests/__stubs__/`)

## Platform Requirements

**Development:**
- Node.js with ESM support
- TypeScript compiler
- Parent monorepo or host app expected to provide `@cinatra-ai/sdk-extensions`, `@cinatra-ai/sdk-ui`, and Vitest stubs at `../../../tests/__stubs__/`

**Production:**
- Deployed as a Next.js connector package within the Cinatra AI host application
- Host application must call `registerGeminiConnector(deps)` at boot (see `src/deps.ts`)
- Connector slug: `connector-gemini`; Cinatra kind: `connector` (see `package.json` `cinatra` field)

---

*Stack analysis: 2026-06-09*
