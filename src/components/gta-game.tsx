"use client";

import * as React from "react";
import { X } from "lucide-react";
import { io, type Socket } from "socket.io-client";
import type { UserId } from "@/lib/types";

/**
 * GTA-style 2-player top-down mini-game.
 *
 * - Top-down canvas world: streets, buildings, both players as little cars/
 *   characters. WASD to move, mouse to aim, click to shoot.
 * - Real-time multiplayer: player positions + bullets relayed over a self-hosted
 *   socket.io server (mini-services/gta-realtime, port 3004), reachable from the
 *   browser through the gateway as io("/?XTransformPort=3004"). Works across
 *   different devices/browsers — both players share the SAME world.
 * - Optimized: fixed-timestep update (60fps), camera follows local player,
 *   offscreen entities culled, no per-frame allocations. requestAnimationFrame
 *   loop pauses on tab hidden.
 * - Both players spawn in the SAME world (fixed seed) at different spawn
 *   points and can see each other move/shoot in real time.
 */

const WORLD_W = 2000;
const WORLD_H = 2000;
const PLAYER_R = 14;
const PLAYER_SPEED = 200; // px/s
const BULLET_SPEED = 520;
const BULLET_LIFE = 1.4; // s
const BULLET_R = 4;
const FIRE_COOLDOWN = 0.22; // s
const MAX_HP = 100;

interface Player {
  id: string;
  x: number;
  y: number;
  angle: number; // facing radians
  hp: number;
  color: string;
  name: string;
  lastSeen: number;
  shooting?: boolean;
}

interface Bullet {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

interface HitMarker {
  x: number;
  y: number;
  life: number;
}

// Buildings (fixed seed → same world for both players)
const BUILDINGS = (() => {
  const arr: { x: number; y: number; w: number; h: number; color: string }[] = [];
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const colors = ["#2a2440", "#241f38", "#2e2848", "#221c36"];
  for (let i = 0; i < 22; i++) {
    const w = 70 + rnd() * 130;
    const h = 70 + rnd() * 130;
    arr.push({
      x: 80 + rnd() * (WORLD_W - 160 - w),
      y: 80 + rnd() * (WORLD_H - 160 - h),
      w,
      h,
      color: colors[Math.floor(rnd() * colors.length)],
    });
  }
  return arr;
})();

// Spawn points for the two players — close together so they can see each other
const SPAWNS: Record<string, { x: number; y: number; color: string; name: string }> = {
  user1: { x: 900, y: 900, color: "#a78bfa", name: "You" },
  user2: { x: 1100, y: 1100, color: "#f472b6", name: "Love" },
};

function rectCollide(x: number, y: number, r: number, rect: { x: number; y: number; w: number; h: number }) {
  return (
    x + r > rect.x &&
    x - r < rect.x + rect.w &&
    y + r > rect.y &&
    y - r < rect.y + rect.h
  );
}

function blocked(x: number, y: number, r: number) {
  if (x < r || x > WORLD_W - r || y < r || y > WORLD_H - r) return true;
  for (const b of BUILDINGS) if (rectCollide(x, y, r, b)) return true;
  return false;
}

export function GtaGame({
  myId,
  onClose,
}: {
  myId: UserId;
  onClose: () => void;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [hp, setHp] = React.useState(MAX_HP);
  const [kills, setKills] = React.useState(0);
  const [gameOver, setGameOver] = React.useState(false);
  const [partnerOnline, setPartnerOnline] = React.useState(false);
  const partnerOnlineRef = React.useRef(false);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ---- networking ----
    // Real-time multiplayer over a self-hosted socket.io relay
    // (mini-services/gta-realtime, port 3004). The browser reaches it through
    // the gateway as io("/?XTransformPort=3004"). Unlike BroadcastChannel —
    // which is scoped to a single browser — socket.io crosses devices and
    // browsers, so both players actually end up in the SAME world.
    const spawn = SPAWNS[myId];
    const me: Player = {
      id: myId,
      x: spawn.x,
      y: spawn.y,
      angle: 0,
      hp: MAX_HP,
      color: spawn.color,
      name: spawn.name,
      lastSeen: Date.now(),
    };
    // The relay assigns each connecting client a seat ("user1"|"user2") so two
    // different devices always get distinct in-game identities — even when the
    // chat app's local-only identity resolution can't coordinate across devices
    // (i.e. when Supabase isn't configured). Until the seat arrives we use the
    // chat identity (myId) as a hint.
    let mySeat: UserId = myId;

    // remote players (the partner)
    const players = new Map<string, Player>();
    const bullets: Bullet[] = [];
    const hitMarkers: HitMarker[] = [];
    const myBullets: Bullet[] = [];

    type StateSnap = {
      id: string;
      x: number;
      y: number;
      a: number;
      hp: number;
      s: boolean;
    };
    type EvtMsg =
      | { t: "b"; id: string; o: string; x: number; y: number; vx: number; vy: number }
      | { t: "dead"; id: string };

    /** Upsert a remote player from a state snapshot. */
    const upsertRemote = (snap: StateSnap) => {
      if (!snap || snap.id === mySeat) return;
      const s = SPAWNS[snap.id as UserId];
      const existing = players.get(snap.id);
      if (existing) {
        existing.x = snap.x;
        existing.y = snap.y;
        existing.angle = snap.a;
        existing.hp = snap.hp;
        existing.shooting = snap.s;
        existing.lastSeen = Date.now();
      } else {
        players.set(snap.id, {
          id: snap.id,
          x: snap.x,
          y: snap.y,
          angle: snap.a,
          hp: snap.hp,
          color: s?.color ?? "#f472b6",
          name: s?.name ?? "Player",
          lastSeen: Date.now(),
          shooting: snap.s,
        });
      }
    };

    const onEvt = (msg: EvtMsg) => {
      if (!msg) return;
      if (msg.t === "b") {
        if (msg.o === mySeat) return;
        bullets.push({
          id: msg.id,
          ownerId: msg.o,
          x: msg.x,
          y: msg.y,
          vx: msg.vx,
          vy: msg.vy,
          life: BULLET_LIFE,
        });
      } else if (msg.t === "dead") {
        if (msg.id !== mySeat) {
          setKills((k) => k + 1);
        }
      }
    };

    const socket: Socket = io("/?XTransformPort=3004", {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
      timeout: 8000,
    });

    // Warm up the in-process relay (idempotent) so the socket.io server is
    // definitely listening on port 3004 before we try to connect.
    void fetch("/api/gta-realtime").catch(() => {});

    socket.on("connect", () => {
      socket.emit("join", { hint: mySeat });
    });
    socket.on("disconnect", () => {
      /* will auto-reconnect; presence recovers via heartbeat */
    });
    // The relay assigns us a seat. Adopt it: respawn at the seat's spawn point,
    // take its color/name, and use it as our broadcast id from now on.
    socket.on("seat", (payload: { seat?: UserId }) => {
      const seat = payload?.seat;
      if (!seat || seat === mySeat) return;
      mySeat = seat;
      me.id = seat;
      const sp = SPAWNS[seat];
      me.x = sp.x;
      me.y = sp.y;
      me.color = sp.color;
      me.name = sp.name;
      me.hp = MAX_HP;
      setHp(MAX_HP);
      // Drop any remote ghost that was keyed by our old hint id.
      players.delete(myId);
    });
    socket.on("state", (snap: StateSnap) => upsertRemote(snap));
    socket.on("evt", (msg: EvtMsg) => onEvt(msg));
    socket.on("presence", (payload: { users?: string[] }) => {
      const users = new Set(payload?.users ?? []);
      // Drop remotes that are no longer online.
      for (const id of Array.from(players.keys())) {
        if (!users.has(id)) players.delete(id);
      }
    });
    socket.on("leave", (payload: { id?: string }) => {
      if (payload?.id) players.delete(payload.id);
    });
    // If already connected (fast reconnect), announce ourselves right away.
    if (socket.connected) socket.emit("join", { hint: mySeat });

    /** Push our own state snapshot to the partner. */
    const sendState = () => {
      if (socket.connected) {
        socket.emit("state", {
          id: mySeat,
          x: me.x,
          y: me.y,
          a: me.angle,
          hp: me.hp,
          s: mouse.down,
        });
      }
    };

    /** Send an instantaneous event (bullet spawn, death). */
    const sendEvt = (msg: EvtMsg) => {
      if (socket.connected) socket.emit("evt", msg);
    };

    // heartbeat: re-broadcast our state every 1s so the partner always has a
    // fresh snapshot even when we're idle, and presence recovers automatically
    // after a transient disconnect.
    const hb = setInterval(() => {
      sendState();
    }, 1000);

    // ---- input ----
    const keys: Record<string, boolean> = {};
    const mouse = { x: 0, y: 0, down: false };
    const onKeyDown = (e: KeyboardEvent) => {
      keys[e.key.toLowerCase()] = true;
      if (["w", "a", "s", "d", " "].includes(e.key.toLowerCase())) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys[e.key.toLowerCase()] = false;
    };
    const onMouseMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) mouse.down = true;
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) mouse.down = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);

    // ---- game loop ----
    let raf = 0;
    let last = performance.now();
    let running = true;
    let fireTimer = 0;
    let sendTimer = 0;
    let lastSent = { x: me.x, y: me.y, a: me.angle, hp: me.hp, s: false };
    const gameOverRef = { current: false };
    const goDead = () => {
      if (!gameOverRef.current) {
        gameOverRef.current = true;
        setGameOver(true);
      }
    };

    const onVis = () => {
      running = document.visibilityState === "visible";
      if (running) {
        last = performance.now();
        loop();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    const loop = () => {
      if (!running) return;
      const now = performance.now();
      const dt = Math.max(0, Math.min((now - last) / 1000, 0.05));
      last = now;

      // --- movement ---
      if (!gameOverRef.current && me.hp > 0) {
        let dx = 0;
        let dy = 0;
        if (keys["w"] || keys["arrowup"]) dy -= 1;
        if (keys["s"] || keys["arrowdown"]) dy += 1;
        if (keys["a"] || keys["arrowleft"]) dx -= 1;
        if (keys["d"] || keys["arrowright"]) dx += 1;
        const len = Math.hypot(dx, dy);
        if (len > 0) {
          dx /= len;
          dy /= len;
          const nx = me.x + dx * PLAYER_SPEED * dt;
          const ny = me.y + dy * PLAYER_SPEED * dt;
          // axis-separated collision so you slide along walls
          if (!blocked(nx, me.y, PLAYER_R)) me.x = nx;
          if (!blocked(me.x, ny, PLAYER_R)) me.y = ny;
          me.angle = Math.atan2(dy, dx);
        }
      }

      // --- aim (toward mouse) ---
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      const camX = me.x - cw / 2;
      const camY = me.y - ch / 2;
      const worldMouseX = mouse.x + camX;
      const worldMouseY = mouse.y + camY;
      me.angle = Math.atan2(worldMouseY - me.y, worldMouseX - me.x);

      // --- shooting ---
      fireTimer -= dt;
      if (!gameOverRef.current && me.hp > 0 && mouse.down && fireTimer <= 0) {
        fireTimer = FIRE_COOLDOWN;
        const bid = `${mySeat}-${now}-${Math.random().toString(36).slice(2, 6)}`;
        const b: Bullet = {
          id: bid,
          ownerId: mySeat,
          x: me.x + Math.cos(me.angle) * (PLAYER_R + 2),
          y: me.y + Math.sin(me.angle) * (PLAYER_R + 2),
          vx: Math.cos(me.angle) * BULLET_SPEED,
          vy: Math.sin(me.angle) * BULLET_SPEED,
          life: BULLET_LIFE,
        };
        myBullets.push(b);
        sendEvt({ t: "b", id: bid, o: mySeat, x: b.x, y: b.y, vx: b.vx, vy: b.vy });
        sendState();
      }

      // --- update my bullets ---
      for (let i = myBullets.length - 1; i >= 0; i--) {
        const b = myBullets[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= dt;
        let dead = b.life <= 0 || blocked(b.x, b.y, BULLET_R);
        // hit remote players?
        for (const [, p] of players) {
          if (p.hp <= 0) continue;
          if (Math.hypot(b.x - p.x, b.y - p.y) < PLAYER_R + BULLET_R) {
            dead = true;
            p.hp = Math.max(0, p.hp - 12);
            hitMarkers.push({ x: b.x, y: b.y, life: 0.3 });
            // tell partner they got hit (they track their own hp; we track kill)
            if (p.hp <= 0) {
              sendEvt({ t: "dead", id: p.id });
            }
            break;
          }
        }
        if (dead) myBullets.splice(i, 1);
      }

      // --- update remote bullets + check if they hit me ---
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= dt;
        let dead = b.life <= 0 || blocked(b.x, b.y, BULLET_R);
        if (!dead && me.hp > 0 && Math.hypot(b.x - me.x, b.y - me.y) < PLAYER_R + BULLET_R) {
          dead = true;
          me.hp = Math.max(0, me.hp - 12);
          setHp(me.hp);
          hitMarkers.push({ x: b.x, y: b.y, life: 0.3 });
          if (me.hp <= 0) {
            goDead();
          }
        }
        if (dead) bullets.splice(i, 1);
      }

      // --- hit markers ---
      for (let i = hitMarkers.length - 1; i >= 0; i--) {
        hitMarkers[i].life -= dt;
        if (hitMarkers[i].life <= 0) hitMarkers.splice(i, 1);
      }

      // --- cull stale remote players ---
      const cutoff = Date.now() - 6000;
      for (const [id, p] of players) {
        if (p.lastSeen < cutoff) players.delete(id);
      }
      // update partner-online indicator
      const online = players.size > 0;
      if (online !== partnerOnlineRef.current) {
        partnerOnlineRef.current = online;
        setPartnerOnline(online);
      }

      // --- network: send position ~10/s, but only when something changed
      // (moved, aimed, or shooting state toggled) to avoid spamming when idle.
      sendTimer -= dt;
      if (sendTimer <= 0) {
        sendTimer = 0.1;
        const moved =
          Math.abs(me.x - lastSent.x) > 0.5 ||
          Math.abs(me.y - lastSent.y) > 0.5 ||
          Math.abs(me.angle - lastSent.a) > 0.02 ||
          me.hp !== lastSent.hp ||
          mouse.down !== lastSent.s;
        if (moved) {
          lastSent = { x: me.x, y: me.y, a: me.angle, hp: me.hp, s: mouse.down };
          sendState();
        }
      }

      // --- render ---
      ctx.clearRect(0, 0, cw, ch);
      ctx.save();
      ctx.translate(-camX, -camY);

      // ground
      ctx.fillStyle = "#171322";
      ctx.fillRect(camX, camY, cw, ch);
      // road grid
      ctx.strokeStyle = "#221d36";
      ctx.lineWidth = 1;
      const grid = 80;
      const startX = Math.floor(camX / grid) * grid;
      const startY = Math.floor(camY / grid) * grid;
      for (let x = startX; x < camX + cw; x += grid) {
        ctx.beginPath();
        ctx.moveTo(x, camY);
        ctx.lineTo(x, camY + ch);
        ctx.stroke();
      }
      for (let y = startY; y < camY + ch; y += grid) {
        ctx.beginPath();
        ctx.moveTo(camX, y);
        ctx.lineTo(camX + cw, y);
        ctx.stroke();
      }

      // buildings
      for (const b of BUILDINGS) {
        // cull offscreen
        if (b.x + b.w < camX || b.x > camX + cw || b.y + b.h < camY || b.y > camY + ch) continue;
        ctx.fillStyle = b.color;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = "#3a3358";
        ctx.lineWidth = 2;
        ctx.strokeRect(b.x, b.y, b.w, b.h);
      }

      // bullets (mine + remote)
      ctx.fillStyle = "#fde047";
      for (const b of myBullets.concat(bullets)) {
        if (b.x < camX - 20 || b.x > camX + cw + 20 || b.y < camY - 20 || b.y > camY + ch + 20) continue;
        ctx.beginPath();
        ctx.arc(b.x, b.y, BULLET_R, 0, Math.PI * 2);
        ctx.fill();
      }

      // hit markers
      for (const h of hitMarkers) {
        ctx.globalAlpha = h.life / 0.3;
        ctx.fillStyle = "#f87171";
        ctx.beginPath();
        ctx.arc(h.x, h.y, 8 * (1 - h.life / 0.3) + 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // remote players
      for (const [, p] of players) {
        if (p.x < camX - 40 || p.x > camX + cw + 40 || p.y < camY - 40 || p.y > camY + ch + 40) continue;
        drawPlayer(ctx, p, false);
      }

      // me
      if (me.hp > 0) drawPlayer(ctx, me, true);

      ctx.restore();

      // crosshair
      ctx.strokeStyle = "rgba(253, 224, 71, 0.7)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(mouse.x, mouse.y, 10, 0, Math.PI * 2);
      ctx.moveTo(mouse.x - 16, mouse.y);
      ctx.lineTo(mouse.x - 6, mouse.y);
      ctx.moveTo(mouse.x + 6, mouse.y);
      ctx.lineTo(mouse.x + 16, mouse.y);
      ctx.moveTo(mouse.x, mouse.y - 16);
      ctx.lineTo(mouse.x, mouse.y - 6);
      ctx.moveTo(mouse.x, mouse.y + 6);
      ctx.lineTo(mouse.x, mouse.y + 16);
      ctx.stroke();

      // --- minimap (top-right) so players can find each other ---
      const mmSize = 130;
      const mmX = cw - mmSize - 16;
      const mmY = 16;
      const mmScale = mmSize / WORLD_W;
      ctx.fillStyle = "rgba(15, 12, 25, 0.8)";
      ctx.fillRect(mmX, mmY, mmSize, mmSize);
      ctx.strokeStyle = "rgba(167, 139, 250, 0.5)";
      ctx.lineWidth = 1;
      ctx.strokeRect(mmX, mmY, mmSize, mmSize);
      // buildings on minimap
      ctx.fillStyle = "rgba(58, 51, 88, 0.7)";
      for (const b of BUILDINGS) {
        ctx.fillRect(mmX + b.x * mmScale, mmY + b.y * mmScale, Math.max(1, b.w * mmScale), Math.max(1, b.h * mmScale));
      }
      // remote players on minimap
      for (const [, p] of players) {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(mmX + p.x * mmScale, mmY + p.y * mmScale, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // me on minimap (pulsing)
      const pulse = 3 + Math.sin(now / 200) * 1.5;
      ctx.fillStyle = me.color;
      ctx.beginPath();
      ctx.arc(mmX + me.x * mmScale, mmY + me.y * mmScale, Math.max(1.5, pulse), 0, Math.PI * 2);
      ctx.fill();

      raf = requestAnimationFrame(loop);
    };

    loop();

    // resize handler
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      clearInterval(hb);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVis);
      socket.disconnect();
    };
  }, [myId]);

  // respawn — close the game; the player can reopen it to start fresh.
  const respawn = () => {
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black">
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        style={{ cursor: "none" }}
      />

      {/* HUD */}
      <div className="pointer-events-none absolute left-4 top-4 flex flex-col gap-2">
        <div className="rounded-xl bg-black/60 px-3 py-2 backdrop-blur">
          <div className="text-[11px] font-medium text-white/60">HEALTH</div>
          <div className="mt-1 h-2 w-40 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${hp}%`,
                background:
                  hp > 50
                    ? "linear-gradient(90deg,#34d399,#10b981)"
                    : hp > 20
                    ? "linear-gradient(90deg,#fbbf24,#f59e0b)"
                    : "linear-gradient(90deg,#f87171,#ef4444)",
              }}
            />
          </div>
        </div>
        <div className="rounded-xl bg-black/60 px-3 py-1.5 backdrop-blur">
          <span className="text-[11px] font-medium text-white/60">KILLS </span>
          <span className="text-sm font-bold text-amber-300">{kills}</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-xl bg-black/60 px-3 py-1.5 backdrop-blur">
          <span
            className={`h-2 w-2 rounded-full ${
              partnerOnline ? "bg-emerald-400" : "bg-white/30"
            }`}
          />
          <span className="text-[11px] font-medium text-white/70">
            {partnerOnline ? "Love is here" : "Waiting for Love…"}
          </span>
        </div>
      </div>

      {/* controls hint */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-4 py-1.5 text-[11px] text-white/70 backdrop-blur">
        <span className="font-mono font-bold text-white">WASD</span> move ·
        <span className="ml-1 font-mono font-bold text-white">MOUSE</span> aim ·
        <span className="ml-1 font-mono font-bold text-white">CLICK</span> shoot
      </div>

      {/* close */}
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 bottom-4 grid h-10 w-10 place-items-center rounded-full bg-black/60 text-white backdrop-blur transition hover:bg-black/80"
        aria-label="Exit game"
      >
        <X className="h-5 w-5" />
      </button>

      {/* game over */}
      {gameOver && (
        <div className="absolute inset-0 grid place-items-center bg-black/70 backdrop-blur-sm">
          <div className="text-center">
            <p className="text-5xl font-black text-red-500">WASTED</p>
            <p className="mt-3 text-sm text-white/60">Kills: {kills}</p>
            <button
              type="button"
              onClick={respawn}
              className="mt-6 rounded-2xl bg-gradient-to-r from-violet-500 to-pink-500 px-6 py-3 text-sm font-semibold text-white shadow-lg"
            >
              Respawn
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  p: Player,
  me: boolean
) {
  ctx.save();
  ctx.translate(p.x, p.y);
  // body
  ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.arc(0, 0, PLAYER_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = me ? "#fff" : "rgba(255,255,255,0.4)";
  ctx.lineWidth = me ? 2 : 1;
  ctx.stroke();
  // gun + aim line
  ctx.rotate(p.angle);
  ctx.fillStyle = "#fde047";
  ctx.fillRect(PLAYER_R - 2, -2.5, 12, 5);
  if (p.shooting) {
    ctx.strokeStyle = "rgba(253, 224, 71, 0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PLAYER_R, 0);
    ctx.lineTo(PLAYER_R + 60, 0);
    ctx.stroke();
  }
  ctx.restore();
  // name + hp bar
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(p.name, p.x, p.y - PLAYER_R - 8);
  if (p.hp < MAX_HP) {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(p.x - 16, p.y - PLAYER_R - 6, 32, 3);
    ctx.fillStyle = p.hp > 50 ? "#34d399" : p.hp > 20 ? "#fbbf24" : "#ef4444";
    ctx.fillRect(p.x - 16, p.y - PLAYER_R - 6, 32 * (p.hp / MAX_HP), 3);
  }
}
