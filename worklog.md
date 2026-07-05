---
Task ID: gta-multiplayer-fix
Agent: Z.ai Code (main)
Task: Fix the GTA clone mini-game so two players on different devices see each other in real time (multiplayer was broken — each player was in their own isolated world).

Work Log:
- Extracted the uploaded workspace tar; located the game at `src/components/gta-game.tsx` and its networking at `src/lib/supabase.ts` / `src/lib/chat-store.ts`.
- Root cause #1 (transport): the game used Supabase Realtime for cross-device sync, but `.env` had no `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY`, so `isSupabaseConfigured` was false and the game silently fell back to `BroadcastChannel` — which is scoped to a SINGLE browser. Two different devices therefore ended up in two isolated worlds.
- Root cause #2 (identity): without Supabase, the chat app's `LocalBackend.claimIdentity` uses `localStorage`, which is per-browser. Both devices independently claimed `user1`. Even with a working transport, the game keys remote players by id, so two `user1`s would be invisible to each other.
- Fix #1 — replaced Supabase + BroadcastChannel transport in the game with a self-hosted socket.io relay: `mini-services/gta-realtime/index.ts` (standalone, for the user's own deployments) + `src/lib/gta-realtime-server.ts` (in-process, for the sandbox). Client connects via `io("/?XTransformPort=3004")` through the gateway. Protocol: `join {hint}` → server assigns a `seat` ("user1"|"user2") → client adopts the seat as its in-game id and spawn point; `state` snapshots (x,y,a,hp,s) relayed at ~10 Hz when changed + 1 Hz heartbeat; `evt` relays bullets/deaths; `presence`/`leave` keep the online list fresh.
- Fix #2 — relay assigns seats on `join` (first free seat, honoring the client's hint when non-colliding), so two different devices always get distinct in-game identities — no Supabase required.
- Sandbox constraint: the environment reaps all background processes started via the Bash tool, so a standalone `bun run dev` mini-service won't stay alive. Solved by hosting the relay INSIDE the already-running, persistent Next.js process: `src/instrumentation.ts` (runs at server boot), `src/app/layout.tsx` (server-component side effect picked up by HMR), and `src/app/api/gta-realtime/route.ts` (warm-up endpoint the client pings on mount). `ensureRealtimeServer()` is idempotent + hot-swappable via a VERSION nonce so code edits are picked up without a restart.
- Iteration note: an earlier broken version left an orphaned relay bound to port 3003 (could not be closed because `io.close()` was blocked by active browser connections and no live reference remained). Switched the active relay to port 3004 to sidestep it; the orphan on 3003 is harmless (clients use 3004). On a fresh deployment (production / `next start`) there is no orphan — `instrumentation.ts` starts the relay cleanly on 3004.

Verification (Agent Browser, two isolated sessions `me` + `partner` through the gateway at :81):
- Both sessions: password gate → chat → opened the GTA game.
- Relay logs: `[gta-realtime] join: user1 (online: user1)` then `join: user2 (online: user1, user2)` — both seats assigned, both online.
- Both HUDs flipped from "Waiting for Love…" to "Love is here" (bidirectional state-snapshot reception).
- No console errors on either session.
- VLM (glm-4.6v) analysis of both screenshots: HUD shows "Love is here" and 2 player dots visible in each view — i.e. each player sees themselves AND their partner in the same world.
- Lint clean; page + API return HTTP 200; relay listening on 3004 inside the persistent Next.js process (pid 1149).

Stage Summary:
- Files added: `mini-services/gta-realtime/{package.json,index.ts}`, `src/lib/gta-realtime-server.ts`, `src/instrumentation.ts`, `src/app/api/gta-realtime/route.ts`.
- Files modified: `src/components/gta-game.tsx` (socket.io transport + seat adoption), `src/app/layout.tsx` (relay warm-up side effect), `package.json` (added `@supabase/supabase-js`, `socket.io`, `socket.io-client`).
- The game now works as true real-time 2-player across devices/browsers with NO external services required. The standalone `mini-services/gta-realtime` is provided for deployments that prefer a separate relay process; the in-process relay is the default.
- Note for the user: if you later configure Supabase env vars, the chat app's cross-device identity will also coordinate (and the game will keep using the socket.io relay, which is now its primary transport).
