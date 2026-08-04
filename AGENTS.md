# TuD Agent Guide

This file is the repository-wide operating guide for human contributors and coding agents. More specific `AGENTS.md` files may add rules for a subtree, but they must not weaken the security, privacy, data-preservation, or verification requirements here.

## Project intent

TuD is a lightweight, self-hosted subscription manager. It is a standalone web product, not a ChatGPT-hosted app and not an extension of the original TD iOS codebase.

The two primary product requirements are equally important:

1. Excellent performance and a small operational footprint.
2. A polished, restrained, responsive interface.

Do not trade one requirement away for the other.

## Product rules

- Store user and subscription data on the server. Do not use browser storage as the source of truth.
- Authentication belongs to TuD. Keep email/password login and Passkey support independent of third-party identity providers.
- Design for self-hosting and straightforward server migration.
- Desktop and mobile are first-class surfaces.
- Prefer useful information over marketing copy. “Less, but better” is the default UI principle.
- Categories are user-owned data. Do not replace custom categories with a fixed enum.
- Subscription cards must use recognizable, high-quality service artwork. Keep icon sizing, optical padding, corner radius, and container treatment consistent.
- Learn from reference products such as Wallos at the level of product ideas and interaction patterns. Do not copy their source code, branding, or page composition wholesale.

## Current stack

- Next.js App Router with React and TypeScript
- PostgreSQL with Drizzle ORM
- Better Auth with email/password and Passkey support
- Lucide for interface icons
- Local brand assets under `public/brands/`

Avoid adding large UI frameworks, client state libraries, or infrastructure layers unless the existing stack cannot reasonably solve the problem.

## Architecture

- `app/`: routes, API handlers, and UI components
- `app/components/Dashboard.tsx`: primary subscription-management experience
- `app/components/BrandIcon.tsx`: normalized brand-icon rendering through stable `iconId` values
- `app/components/BrandPicker.tsx`: one-field server-backed icon search and official-site discovery
- `app/components/CalendarView.tsx`: recurring renewal calendar with responsive agenda fallback
- `app/api/`: authenticated server APIs
- `db/schema.ts`: database schema
- `db/icons.ts`: canonical icon catalog, content-addressed assets, search, and website-domain entries
- `db/subscriptions.ts`: subscription queries and mutations
- `db/categories.ts`: user-owned category queries and mutations
- `db/users.ts`: authenticated profile and private avatar persistence
- `lib/generated/icon-catalog.json`: reproducible multi-source seed consumed only by the server
- `lib/website-icon-discovery.server.ts`: SSRF-safe official-site icon discovery
- `migrations/`: committed Drizzle migrations
- `lib/auth.ts`: server authentication configuration
- `lib/auth-client.ts`: client authentication helpers

Keep authorization checks at the API/server boundary. Every user-owned query and mutation must be scoped by the authenticated user ID.

The PostgreSQL icon catalog is the sole source of truth for selectable icons. The client may render bundled fast paths, but must not maintain a second selectable brand catalog, persist remote image URLs, or accept provider-specific icon keys as authoritative. Subscriptions reference catalog rows through `iconId`; assets are fetched, validated, and cached by the server.

## Data and migrations

- Schema changes require a committed migration.
- Generate migrations with `npm run db:generate`.
- Apply migrations with `npm run db:migrate`.
- Never silently discard existing user data.
- Preserve foreign keys and cascade behavior for user-owned records.
- Validate and normalize untrusted input on the server, even when the client already validates it.
- Never commit real credentials, session tokens, database dumps, or production `.env` files.

## Security and privacy

- Treat all authentication, email, profile, subscription, database, and deployment data as sensitive.
- Keep secrets in ignored environment files or the deployment platform's secret store. Examples must contain unmistakable placeholders only.
- Never log passwords, OTPs, session cookies, passkey material, SMTP credentials, database URLs, or full private request bodies.
- Do not weaken SSRF protections, remote-image validation, authorization boundaries, rate limits, or production environment checks to make development easier.
- Any new outbound fetch must define allowed protocols, redirect behavior, timeouts, response-size limits, and private-network handling.
- Report vulnerabilities through the private process in `SECURITY.md`; do not open a public issue containing exploit details.

## Open-source contribution rules

- Keep changes reviewable and focused. Separate refactors from behavior changes when practical.
- Add or update tests for bug fixes and behavior changes. Explain any important path that cannot be tested automatically.
- Do not add generated files, vendored code, copied assets, or dependencies without recording their source and license where required.
- Brand names and artwork are identification assets, not project ownership claims. Preserve attribution and trademark notices in `THIRD_PARTY_NOTICES.md`.
- Avoid new runtime dependencies when the platform or current stack can solve the problem clearly. Run `npm audit` and review license compatibility before accepting a new dependency.
- Public interfaces, environment variables, database migrations, backup formats, and deployment scripts are compatibility surfaces. Document breaking changes and provide a migration path.
- Do not commit editor state, local agent transcripts, screenshots containing private data, build output, or deployment artifacts.
- Follow `CONTRIBUTING.md` for the branch, commit, and pull-request workflow.

## UI implementation standards

- Reuse the existing visual language before introducing new patterns.
- Keep visual hierarchy compact: brand, primary action, useful summary, categories, subscriptions.
- Avoid redundant headings, captions, helper copy, and decorative controls.
- Controls must work; do not ship dead buttons in primary flows.
- Use native semantic elements and preserve keyboard focus visibility.
- Use Lucide icons for interface controls. Do not use emoji, text glyphs, or hand-drawn SVG approximations.
- Use real brand assets for subscription services whenever available. A user-defined 1–4 character letter icon is the explicit fallback when no usable catalog or official-site artwork exists; it must still be stored in the server icon index.
- Brand artwork should sit inside the shared `BrandIcon` treatment rather than receiving unrelated per-card sizing.
- Responsive layouts must be checked at desktop and narrow mobile widths.
- Animations should be short, transform/opacity based, and disabled by `prefers-reduced-motion`.

## Performance standards

- Prefer server rendering and server data access by default.
- Add client-side state only for interactions that need it.
- Keep client bundles small and avoid unnecessary dependencies.
- Use database indexes for user-scoped lists and date-oriented queries.
- Avoid repeated network requests when local state can be updated safely after a successful mutation.
- Do not introduce polling, background timers, or large image payloads without a concrete product need.

## Local development

Typical local setup:

```bash
docker compose up -d postgres
npm run db:migrate
npm run dev
```

The application is normally available at `http://localhost:3000`.

Docker is a local convenience for PostgreSQL, not an architectural requirement for deployment. Production may use any compatible PostgreSQL service.

Copy `.env.example` to `.env` for local development. Keep `.env` and `.env.local` untracked and mode `600` on shared machines. Production configuration belongs in an untracked `.env.production` or a secret manager.

## Required verification

Before handing off a meaningful change, run:

```bash
npm run test:release
```

This includes linting, TypeScript checking, the Node test suite, brand-catalog generation, and a production build. Run narrower checks while iterating, but do not use them as the final verification for a meaningful change.

For UI changes, also verify in a real browser:

- the primary desktop state;
- a narrow mobile state;
- the interaction that changed;
- a clean load without application console errors.

For authentication or data changes, verify authorization and persistence rather than relying only on visual checks.

## Change discipline

- Preserve unrelated user changes in a dirty worktree.
- Prefer focused edits over broad rewrites.
- Do not copy the TD project structure unless a specific idea remains useful for the web product.
- Do not deploy, publish, push, or change production infrastructure unless the user explicitly asks.
- Keep README and this guide aligned when the stack or operating model changes materially.
- Do not publish packages, create releases, push branches, deploy, or change external infrastructure unless the task explicitly authorizes it.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
