# Clocktower Storyteller — foundation

A mobile-first foundation for a digital tabletop Storyteller.

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
2. Apply `supabase/migrations/0001_initial.sql` through `0007_game_history.sql` in order using the Supabase SQL editor or CLI.
3. Copy the project URL and anon/publishable key into `.env.local` for public room change notifications.
4. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only. Never expose it in client code.
5. The server-side room, player, and game endpoints use the service role after validating inputs.
   Player session tokens are random; the database stores only their SHA-256 hashes. The active
   tab keeps its token in session storage, and the browser keeps a local recovery copy indexed
   by room and display name. Reopen the room in the same browser or enter the same room code and
   display name to resume that seat. Sessions expire after seven days and can be revoked by
   leaving a lobby. Game commands use
   database transactions, idempotency keys, and version checks.

The lobby uses public Supabase Realtime revision notifications and keeps a 2.5-second polling
fallback. Notifications contain no player or game data. Open a room in one tab, then join it
from other tabs or devices using its six-character code.

Create and join requests use database-backed rate limits (3 room creations/hour and 30 join
attempts/10 minutes per client address). In a lobby, the host can add random bots as seats.
Bots make a random legal choice for prompted night actions and votes on player nominations.
Each bot independently has one 50% chance per day to nominate a random legal target. Their
commands are resolved server-side like player commands.

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

The initial `trouble-brewing` ruleset is registered in `src/lib/games/installed-rulesets.ts`.
It contains the 22-character roster, player-count setup, private role assignment, the initial
night information, a server-owned night/day command loop, nominations, public ballots, ghost
votes, and the principal character actions. Storyteller judgment calls use seeded server-side
choices and are recorded through game events. This is an in-progress automated Storyteller
prototype; validate every ability interaction against the official night sheets and rules
before using it for a live game. The game read endpoint projects only public state and the
requesting player’s private view. Never publish authoritative state or private player data to
a shared Realtime channel.

## Security work required before production
- Add CAPTCHA and operational monitoring before exposing room creation publicly.
- Add account authentication only if identities must persist across games or devices.
- Review rate-limit trust boundaries against the deployment proxy and tune limits after playtests.
- Route every new state mutation through the transactional game command boundary.
- Add integration tests against a disposable Supabase project and review RLS policies.
