# Clocktower Storyteller — foundation

A mobile-first, original-content-ready foundation for a digital tabletop Storyteller.
The first milestone intentionally uses generic placeholder roles and no Blood on the
Clocktower scripts, character text, iconography, artwork, or other protected content.

## Requirements
- Node.js 20+
- A Supabase project (optional for the local UI and pure engine tests)

## Run locally
```bash
npm install
cp .env.example .env.local
npm run dev
```
Open http://localhost:3000. The landing page and game-engine unit tests work without
Supabase credentials. The create-room API returns a clear configuration error until
Supabase is configured.

## Checks
```bash
npm test
npm run typecheck
npm run lint
npm run build
```

## Supabase setup
1. Create a Supabase project.
2. Apply `supabase/migrations/0001_initial.sql` and then `supabase/migrations/0002_multiplayer_lobby.sql` using the Supabase SQL editor or CLI.
3. Copy the project URL into `.env.local`. The anon key is not used by this server-only lobby.
4. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only. Never expose it in client code.
5. The server-side room and player endpoints use the service role after validating inputs.
   Player session tokens are random per-tab tokens; the database stores only their SHA-256 hashes.
   Add rate limiting / CAPTCHA before exposing public room creation or joining.

The lobby polls the server every 2.5 seconds for player and ready-state changes. Open a room
in one tab, then join it from other tabs or devices using its six-character code.

## Deploy to Vercel
Import this repository into Vercel, set the three environment variables, and deploy.
The app uses Next.js Route Handlers. Supabase Realtime is the intended delivery layer
for live updates; do not attempt to host a long-lived WebSocket server inside a
Vercel Function.

## Architecture
- `src/domain`: pure TypeScript game state and transition logic, independent of Next.js.
- `src/app/api`: server-side command boundary.
- `src/lib/supabase`: server-only Supabase client.
- `supabase/migrations`: schema and baseline access policies.

The game engine is intentionally not connected to a full role/script catalogue yet.
Before adding licensed content, obtain permission and keep content packs in a separate,
versioned module. All clients must receive filtered state only; never publish the
authoritative state or private player data to a shared Realtime channel.

## Security work required before production
- Add session expiry and a revocation flow, or Supabase Auth, before allowing sensitive room actions.
- Replace the starter room-creation service-role flow with a hardened server command
  layer, rate limits, idempotency keys and abuse controls.
- Add transactional RPCs for all state mutations and optimistic version checks.
- Configure per-player private channels or fetch private state through authorised
  server endpoints. Do not rely on client-side filtering for secrecy.
- Add integration tests against a disposable Supabase project and review RLS policies.
