// Warm-up endpoint for the GTA realtime relay.
//
// GET /api/gta-realtime  -> { ok: true, port: 3004 }
//
// The gta-game client pings this on mount so the in-process socket.io server
// (src/lib/gta-realtime-server.ts) is guaranteed to be running before the
// socket.io-client connects. Idempotent.

import { NextResponse } from "next/server";
import { ensureRealtimeServer } from "@/lib/gta-realtime-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  ensureRealtimeServer();
  return NextResponse.json({ ok: true, port: 3004 });
}
