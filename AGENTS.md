# Repository Guidelines

## Project Structure & Module Organization

- `src/app` contains the Next.js App Router pages and API route handlers. Dynamic room routes live under `src/app/room/[code]` and `src/app/api/rooms/[code]`.
- `src/domain` holds game types and framework-independent game logic. `src/lib/games` contains rulesets, seeded randomness, bot behavior, and game tests.
- `src/components` contains shared UI; `public/sprites` stores character art.
- `supabase/migrations` contains ordered database migrations. Add a new migration rather than editing an already-applied one.

## Build, Test, and Development Commands

- `npm install` installs dependencies; copy `.env.example` to `.env.local` for local configuration.
- `npm run dev` starts the local Next.js server at `http://localhost:3000`.
- `npm test` runs Vitest; `npm run typecheck` runs TypeScript without emitting files; `npm run lint` runs ESLint.
- `npm run build` creates the production build; `npm start` serves that build locally.

## Coding Style & Naming Conventions

Use TypeScript with strict typing, two-space indentation, and the `@/*` alias for imports from `src`. Follow the existing Next.js conventions: PascalCase React components, camelCase functions and variables, and kebab-case route and game identifiers. Keep domain and ruleset logic independent of Next.js. Validate incoming API data and route game mutations through the transactional command boundary. ESLint uses Next.js Core Web Vitals and TypeScript rules; no separate formatter is configured.

## Testing Guidelines

Tests use Vitest in the Node environment and live beside their modules as `*.test.ts` (for example, `src/lib/games/trouble-brewing.test.ts`). Add focused tests for rule changes, especially legal actions, state transitions, and retry-sensitive behavior. Run `npm test`, `npm run typecheck`, and `npm run lint` for changes that affect game behavior or shared code.

## Commit & Pull Request Guidelines

Recent commits use short, lowercase, imperative summaries (for example, `fix bug with nominations`). Keep commits focused. Pull requests should explain the behavior change, list validation performed, link related issues when available, and include screenshots for visible UI changes. Call out database migrations and required environment variables.

## Security & Configuration

Keep secrets in `.env.local` or deployment secrets; never expose service-role credentials or other server secrets through `NEXT_PUBLIC_` variables. Treat `secret_state` and private player views as confidential. Never publish authoritative game state to shared Realtime notifications.
