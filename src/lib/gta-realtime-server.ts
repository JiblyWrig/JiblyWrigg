// Idempotent + hot-swappable bootstrap for the in-process GTA realtime
// socket.io relay (port 3004).
//
// The relay is reached from the browser through the gateway as
// io("/?XTransformPort=3004"). Hosting it inside the Next.js process means it
// lives as long as the app server does — no separate background process to
// keep alive (the sandbox reaps those).
//
// Hot-swap: a VERSION literal acts as the nonce. When this module is
// re-evaluated by HMR after an edit, if the running instance's version differs
// the old server is torn down and a new one (with the latest handlers) is
// brought up on the same port. Bump VERSION when you change the handlers.
//
// Triggered from:
//   - src/instrumentation.ts                 (server startup, for fresh boots)
//   - src/app/layout.tsx                     (server-component side effect, HMR)
//   - src/app/api/gta-realtime/route.ts      (explicit warm-up the client pings)

import { createServer, type Server as HttpServer } from "http";
import { Server, type Socket } from "socket.io";

const PORT = 3004;
const ROOM = "gta";
// Bump this when changing the handlers below; triggers a hot-swap of the relay.
const VERSION = "seat-v1";

type Seat = "user1" | "user2";

interface RtState {
  version: string;
  io: Server;
  http: HttpServer;
}

const g = globalThis as unknown as {
  __gtaRt?: RtState;
  // legacy key from the pre-nonce version — still referenced by the running
  // server, so we clean it up on swap.
  __gtaRealtimeIo?: Server;
  __gtaRealtimeStarted?: boolean;
};

function buildServer(): { io: Server; http: HttpServer } {
  const httpServer = createServer();
  const io = new Server(httpServer, {
    path: "/",
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 30000,
    pingInterval: 10000,
  });

  // Track which seat ("user1"|"user2") is bound to each socket so we can
  // announce leaves, and assign seats on join so two different devices always
  // get distinct in-game identities (the chat app's local-only identity
  // resolution can't coordinate across devices without Supabase).
  const socketToSeat = new Map<string, Seat>();
  const takenSeats = () => new Set(socketToSeat.values());
  const assignSeat = (hint?: string): Seat => {
    const taken = takenSeats();
    if (hint === "user1" && !taken.has("user1")) return "user1";
    if (hint === "user2" && !taken.has("user2")) return "user2";
    if (!taken.has("user1")) return "user1";
    if (!taken.has("user2")) return "user2";
    return "user1"; // both taken (3+ players) — extras collide, 2-player game stays solid
  };
  const onlineUsers = () => [...takenSeats()];
  const broadcastPresence = () =>
    io.to(ROOM).emit("presence", { users: onlineUsers() });

  io.on("connection", (socket: Socket) => {
    socket.join(ROOM);

    socket.on("join", (data: { hint?: string } | undefined) => {
      const seat = assignSeat(data?.hint);
      socketToSeat.set(socket.id, seat);
      // Tell this client which seat it owns; it uses the seat as its in-game id.
      socket.emit("seat", { seat });
      // Tell everyone else someone joined under that seat, and refresh presence.
      socket.to(ROOM).emit("join", { id: seat });
      broadcastPresence();
      console.log(
        `[gta-realtime] join: ${seat} (online: ${onlineUsers().join(", ") || "none"})`
      );
    });

    socket.on("state", (snap: unknown) => {
      socket.to(ROOM).emit("state", snap);
    });

    socket.on("evt", (evt: unknown) => {
      socket.to(ROOM).emit("evt", evt);
    });

    socket.on("disconnect", () => {
      const seat = socketToSeat.get(socket.id);
      socketToSeat.delete(socket.id);
      if (seat) {
        socket.to(ROOM).emit("leave", { id: seat });
        broadcastPresence();
        console.log(
          `[gta-realtime] leave: ${seat} (online: ${onlineUsers().join(", ") || "none"})`
        );
      }
    });

    socket.on("error", (err: unknown) => {
      console.error(`[gta-realtime] socket error (${socket.id}):`, err);
    });
  });

  return { io, http: httpServer };
}

/**
 * Start (or hot-swap to) the relay. Returns the current Server (or null briefly
 * during a swap). Safe to call any number of times; the port is bound exactly
 * once per VERSION.
 */
export function ensureRealtimeServer(): Server | null {
  const existing = g.__gtaRt;
  if (existing && existing.version === VERSION) {
    return existing.io;
  }

  // Tear down whatever is already holding port 3004 (current version or legacy)
  // BEFORE binding the new one, so the port actually frees.
  const teardownAll = async () => {
    const cur = g.__gtaRt;
    g.__gtaRt = undefined;
    if (cur) {
      await new Promise<void>((res) => {
        let done = false;
        const finish = () => { if (!done) { done = true; res(); } };
        try { cur.io.close(finish); } catch { finish(); }
        // io.close also closes the underlying http server.
        setTimeout(finish, 800);
      });
    }
    const legacy = g.__gtaRealtimeIo;
    g.__gtaRealtimeIo = undefined;
    g.__gtaRealtimeStarted = undefined;
    if (legacy) {
      await new Promise<void>((res) => {
        let done = false;
        const finish = () => { if (!done) { done = true; res(); } };
        try { legacy.close(finish); } catch { finish(); }
        setTimeout(finish, 800);
      });
    }
  };

  let started = false;
  let attempts = 0;
  const bringUp = () => {
    if (started) return;
    attempts++;
    if (attempts > 40) {
      console.warn(`[gta-realtime] gave up binding port ${PORT} after ${attempts} attempts`);
      return;
    }
    const { io, http } = buildServer();
    http.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.warn(`[gta-realtime] port ${PORT} busy, retrying in 250ms (attempt ${attempts})…`);
        setTimeout(bringUp, 250);
      } else {
        console.warn(`[gta-realtime] http error:`, err);
      }
    });
    http.listen(PORT, () => {
      started = true;
      g.__gtaRt = { version: VERSION, io, http };
      console.log(
        `[gta-realtime] socket.io server listening on port ${PORT} (version ${VERSION})`
      );
    });
  };

  // Run teardown, then bind. Fire-and-forget; callers don't await.
  void teardownAll().then(bringUp);

  return g.__gtaRt?.io ?? null;
}
