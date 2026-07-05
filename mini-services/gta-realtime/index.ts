// GTA Realtime relay — socket.io mini-service.
//
// Relays player position/presence + instantaneous events (bullets, deaths)
// between the two clients of the GTA mini-game. Runs on port 3004 and is
// reachable from the browser through the gateway as io('/?XTransformPort=3004').
//
// Protocol (client <-> server):
//   -> join   { hint? }                    client requests a seat (hint = its chat id)
//   <- seat   { seat }                     server assigns "user1"|"user2"; client uses it as its id
//   <- presence { users: string[] }        server pushes the online seat list
//   <- join    { id }                      a seat joined (broadcast to others)
//   <- leave   { id }                      a seat left (broadcast to others)
//   -> state   { id,x,y,a,hp,s }           client pushes its own snapshot
//   <- state   { id,x,y,a,hp,s }           server relays other clients' snapshots
//   -> evt     { t:"b"|"dead", ... }       client pushes an instantaneous event
//   <- evt     { ... }                     server relays other clients' events

import { createServer } from "http";
import { Server } from "socket.io";

const PORT = 3004;
const ROOM = "gta";

const httpServer = createServer();
const io = new Server(httpServer, {
  // DO NOT change the path — the gateway (Caddy) uses it to forward to this port.
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 30000,
  pingInterval: 10000,
});

// Track which seat ("user1"|"user2") is bound to each socket so we can
// announce leaves, and assign seats on join so two different devices always
// get distinct in-game identities.
const socketToSeat = new Map<string, "user1" | "user2">();
const takenSeats = () => new Set(socketToSeat.values());
const assignSeat = (hint?: string): "user1" | "user2" => {
  const taken = takenSeats();
  if (
    hint &&
    (hint === "user1" || hint === "user2") &&
    !taken.has(hint as "user1" | "user2")
  ) {
    return hint as "user1" | "user2";
  }
  if (!taken.has("user1")) return "user1";
  if (!taken.has("user2")) return "user2";
  return "user1";
};
function onlineUsers(): string[] {
  return [...takenSeats()];
}

function broadcastPresence() {
  io.to(ROOM).emit("presence", { users: onlineUsers() });
}

io.on("connection", (socket) => {
  // Join the single shared game room immediately.
  socket.join(ROOM);

  socket.on("join", (data: { hint?: string } | undefined) => {
    const seat = assignSeat(data?.hint);
    socketToSeat.set(socket.id, seat);
    // Tell this client which seat it owns; it uses the seat as its in-game id.
    socket.emit("seat", { seat });
    // Tell everyone else someone joined under that seat, and refresh presence.
    socket.to(ROOM).emit("join", { id: seat });
    broadcastPresence();
    console.log(`[gta] join: ${seat} (online: ${onlineUsers().join(", ") || "none"})`);
  });

  // Relay player state snapshots to everyone else in the room.
  socket.on("state", (snap: unknown) => {
    socket.to(ROOM).emit("state", snap);
  });

  // Relay instantaneous events (bullets, deaths) to everyone else.
  socket.on("evt", (evt: unknown) => {
    socket.to(ROOM).emit("evt", evt);
  });

  socket.on("disconnect", () => {
    const seat = socketToSeat.get(socket.id);
    socketToSeat.delete(socket.id);
    if (seat) {
      socket.to(ROOM).emit("leave", { id: seat });
      broadcastPresence();
      console.log(`[gta] leave: ${seat} (online: ${onlineUsers().join(", ") || "none"})`);
    }
  });

  socket.on("error", (err) => {
    console.error(`[gta] socket error (${socket.id}):`, err);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[gta-realtime] socket.io server listening on port ${PORT}`);
});

process.on("SIGTERM", () => {
  console.log("[gta-realtime] SIGTERM, shutting down…");
  io.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  console.log("[gta-realtime] SIGINT, shutting down…");
  io.close(() => process.exit(0));
});
