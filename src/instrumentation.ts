// Next.js instrumentation hook — runs once when the server boots.
// Starts the in-process GTA realtime socket.io relay (port 3003).
// See src/lib/gta-realtime-server.ts for the actual implementation.

import { ensureRealtimeServer } from "@/lib/gta-realtime-server";

export async function register() {
  // Only run in the Node.js runtime (not edge).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  ensureRealtimeServer();
}
