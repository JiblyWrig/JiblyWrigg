"use client";

import * as React from "react";
import { X } from "lucide-react";
import { io, type Socket } from "socket.io-client";
import * as THREE from "three";
import type { UserId } from "@/lib/types";

/**
 * GTA-style 2-player 3D mini-game (Three.js).
 *
 * - Full 3D world: a dark city ground plane with a road grid, extruded 3D
 *   buildings, third-person camera that follows the local player, real-time
 *   lighting + fog. Both players are 3D characters (body + gun) driving around
 *   the same shared world.
 * - Controls: WASD to move (world-relative), mouse to aim (raycast onto the
 *   ground), click to shoot. Same feel as the 2D version, now in 3D.
 * - Real-time multiplayer over the self-hosted socket.io relay
 *   (port 3004, reached as io("/?XTransformPort=3004")). The relay assigns
 *   seats ("user1"|"user2") so two different devices always get distinct
 *   in-game identities. State snapshots (x,z,angle,hp,shooting) are sent
 *   ~10 Hz when changed + a 1 Hz heartbeat; bullets/deaths are relayed as
 *   instantaneous events.
 * - HUD (HTML overlay): HP bar, kills, partner-online indicator, a 2D minimap
 *   (top-right), controls hint, game-over screen, exit button.
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

// Camera: fixed-angle follow cam, above and behind the player.
const CAM_OFFSET = new THREE.Vector3(0, 340, 300);
const CAM_LOOK = new THREE.Vector3(0, 20, 0);

interface Player {
  id: string;
  x: number;
  z: number;
  angle: number; // facing radians (2D-style: 0 = +x)
  hp: number;
  color: string;
  name: string;
  lastSeen: number;
  shooting?: boolean;
  group?: THREE.Group; // 3D mesh group (only for remote players; "me" is built separately)
  ring?: THREE.Mesh; // ground HP ring
}

interface Bullet {
  id: string;
  ownerId: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
  mesh: THREE.Mesh;
}

interface HitMarker {
  x: number;
  z: number;
  life: number;
  mesh: THREE.Mesh;
}

// Buildings (fixed seed → same world for both players). Same footprints as the
// 2D version, now extruded into 3D boxes with per-building heights.
const BUILDINGS = (() => {
  const arr: {
    x: number;
    y: number;
    w: number;
    h: number;
    color: string;
    height: number;
  }[] = [];
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
      height: 60 + rnd() * 90,
    });
  }
  return arr;
})();

// Spawn points for the two players — close together so they can see each other.
const SPAWNS: Record<string, { x: number; y: number; color: string; name: string }> = {
  user1: { x: 900, y: 900, color: "#a78bfa", name: "You" },
  user2: { x: 1100, y: 1100, color: "#f472b6", name: "Love" },
};

function rectCollide(x: number, z: number, r: number, rect: { x: number; y: number; w: number; h: number }) {
  return (
    x + r > rect.x &&
    x - r < rect.x + rect.w &&
    z + r > rect.y &&
    z - r < rect.y + rect.h
  );
}

function blocked(x: number, z: number, r: number) {
  if (x < r || x > WORLD_W - r || z < r || z > WORLD_H - r) return true;
  for (const b of BUILDINGS) if (rectCollide(x, z, r, b)) return true;
  return false;
}

/** Build the 3D mesh group for a player (body + gun + ground HP ring + name). */
function buildPlayerMesh(color: string, name: string, isMe: boolean): THREE.Group {
  const g = new THREE.Group();

  // Body — capsule, player color.
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(8, 16, 4, 8),
    new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1 })
  );
  body.position.y = 18;
  g.add(body);

  // Gun — small yellow box pointing along +x (forward).
  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(14, 4, 4),
    new THREE.MeshStandardMaterial({ color: 0xfde047, roughness: 0.4, metalness: 0.3 })
  );
  gun.position.set(11, 20, 0);
  g.add(gun);

  // Outline ring on the ground (thicker + white for the local player).
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(11, 15, 24),
    new THREE.MeshBasicMaterial({
      color: isMe ? 0xffffff : color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.6;
  g.add(ring);
  // tag for HP color updates
  ring.userData.isHpRing = true;

  // Name label (sprite with canvas texture).
  const label = makeLabelSprite(name, isMe ? "#ffffff" : "#cbd5e1");
  label.position.y = 42;
  label.scale.set(48, 12, 1);
  g.add(label);

  return g;
}

function makeLabelSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, 0, 256, 64);
  ctx.font = "bold 34px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  return new THREE.Sprite(mat);
}

function hpRingColor(hp: number): number {
  if (hp > 50) return 0x34d399;
  if (hp > 20) return 0xfbbf24;
  return 0xef4444;
}

export function GtaGame({
  myId,
  onClose,
}: {
  myId: UserId;
  onClose: () => void;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const minimapRef = React.useRef<HTMLCanvasElement>(null);
  const [hp, setHp] = React.useState(MAX_HP);
  const [kills, setKills] = React.useState(0);
  const [gameOver, setGameOver] = React.useState(false);
  const [partnerOnline, setPartnerOnline] = React.useState(false);
  const partnerOnlineRef = React.useRef(false);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ---- Three.js setup ----
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x100c1f);
    scene.fog = new THREE.Fog(0x100c1f, 700, 1500);

    const camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.5,
      4000
    );

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Lights
    const ambient = new THREE.AmbientLight(0x9088ff, 0.55);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(500, 900, 400);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -1100;
    dir.shadow.camera.right = 1100;
    dir.shadow.camera.top = 1100;
    dir.shadow.camera.bottom = -1100;
    dir.shadow.camera.near = 100;
    dir.shadow.camera.far = 2500;
    dir.shadow.bias = -0.0008;
    scene.add(dir);
    // a warm fill light from the opposite side
    const fill = new THREE.DirectionalLight(0xff9ed6, 0.25);
    fill.position.set(-400, 500, -300);
    scene.add(fill);

    // Ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_W, WORLD_H),
      new THREE.MeshStandardMaterial({ color: 0x1a1530, roughness: 0.95, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Road grid (subtle)
    const grid = new THREE.GridHelper(WORLD_W, Math.round(WORLD_W / 80), 0x2a2348, 0x221d36);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.6;
    grid.position.y = 0.2;
    scene.add(grid);

    // World bounds walls (thin tall boxes around the edge so you can't walk off)
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a2348, roughness: 0.9 });
    const wallH = 40;
    const wallT = 8;
    const walls = [
      new THREE.BoxGeometry(WORLD_W, wallH, wallT), // bottom (z=0)
      new THREE.BoxGeometry(WORLD_W, wallH, wallT), // top (z=WORLD_H)
      new THREE.BoxGeometry(wallT, wallH, WORLD_H), // left (x=0)
      new THREE.BoxGeometry(wallT, wallH, WORLD_H), // right (x=WORLD_W)
    ];
    const wallMeshes = walls.map((geo, i) => {
      const m = new THREE.Mesh(geo, wallMat);
      m.castShadow = true;
      m.receiveShadow = true;
      if (i === 0) m.position.set(WORLD_W / 2, wallH / 2, 0);
      if (i === 1) m.position.set(WORLD_W / 2, wallH / 2, WORLD_H);
      if (i === 2) m.position.set(0, wallH / 2, WORLD_H / 2);
      if (i === 3) m.position.set(WORLD_W, wallH / 2, WORLD_H / 2);
      scene.add(m);
      return m;
    });

    // Buildings (3D boxes)
    const buildingMeshes: THREE.Mesh[] = [];
    for (const b of BUILDINGS) {
      const geo = new THREE.BoxGeometry(b.w, b.height, b.h);
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(b.color), roughness: 0.85 });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(b.x + b.w / 2, b.height / 2, b.y + b.h / 2);
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
      buildingMeshes.push(m);
      // rooftop accent edge
      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(b.w + 2, 2, b.h + 2),
        new THREE.MeshStandardMaterial({ color: 0x3a3358, roughness: 0.8 })
      );
      edge.position.set(b.x + b.w / 2, b.height + 1, b.y + b.h / 2);
      scene.add(edge);
    }

    // ---- networking ---- (same seat-based socket.io relay as before)
    const spawn = SPAWNS[myId];
    const me: Player = {
      id: myId,
      x: spawn.x,
      z: spawn.y,
      angle: 0,
      hp: MAX_HP,
      color: spawn.color,
      name: spawn.name,
      lastSeen: Date.now(),
    };
    let mySeat: UserId = myId;

    // The local player's mesh group.
    const myMesh = buildPlayerMesh(me.color, me.name, true);
    scene.add(myMesh);

    // remote players (the partner)
    const players = new Map<string, Player>();
    const bullets: Bullet[] = [];
    const hitMarkers: HitMarker[] = [];
    const myBullets: Bullet[] = [];

    // shared resources for bullets / hit markers
    const bulletGeo = new THREE.SphereGeometry(BULLET_R, 8, 8);
    const bulletMat = new THREE.MeshStandardMaterial({
      color: 0xfde047,
      emissive: 0xfde047,
      emissiveIntensity: 0.7,
      roughness: 0.3,
    });
    const hitGeo = new THREE.RingGeometry(6, 9, 16);
    const hitMat = new THREE.MeshBasicMaterial({
      color: 0xf87171,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
    });

    type StateSnap = {
      id: string;
      x: number;
      y: number; // partner sends 2D-style y; we map it to z
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
        existing.z = snap.y;
        existing.angle = snap.a;
        existing.hp = snap.hp;
        existing.shooting = snap.s;
        existing.lastSeen = Date.now();
      } else {
        const group = buildPlayerMesh(s?.color ?? "#f472b6", s?.name ?? "Player", false);
        scene.add(group);
        const ring = group.children.find((c) => (c as THREE.Mesh).userData?.isHpRing) as THREE.Mesh | undefined;
        players.set(snap.id, {
          id: snap.id,
          x: snap.x,
          z: snap.y,
          angle: snap.a,
          hp: snap.hp,
          color: s?.color ?? "#f472b6",
          name: s?.name ?? "Player",
          lastSeen: Date.now(),
          shooting: snap.s,
          group,
          ring,
        });
      }
    };

    const onEvt = (msg: EvtMsg) => {
      if (!msg) return;
      if (msg.t === "b") {
        if (msg.o === mySeat) return;
        const m = new THREE.Mesh(bulletGeo, bulletMat);
        m.position.set(msg.x, 18, msg.y);
        scene.add(m);
        bullets.push({
          id: msg.id,
          ownerId: msg.o,
          x: msg.x,
          z: msg.y,
          vx: msg.vx,
          vz: msg.vy,
          life: BULLET_LIFE,
          mesh: m,
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
    socket.on("seat", (payload: { seat?: UserId }) => {
      const seat = payload?.seat;
      if (!seat || seat === mySeat) return;
      mySeat = seat;
      me.id = seat;
      const sp = SPAWNS[seat];
      me.x = sp.x;
      me.z = sp.y;
      me.color = sp.color;
      me.name = sp.name;
      me.hp = MAX_HP;
      setHp(MAX_HP);
      // Refresh the local mesh's colors/label for the new seat.
      refreshMeshAppearance(myMesh, sp.color, sp.name, true);
      players.delete(myId);
    });
    socket.on("state", (snap: StateSnap) => upsertRemote(snap));
    socket.on("evt", (msg: EvtMsg) => onEvt(msg));
    socket.on("presence", (payload: { users?: string[] }) => {
      const users = new Set(payload?.users ?? []);
      for (const id of Array.from(players.keys())) {
        if (!users.has(id)) {
          const p = players.get(id);
          if (p?.group) {
            scene.remove(p.group);
            disposeGroup(p.group);
          }
          players.delete(id);
        }
      }
    });
    socket.on("leave", (payload: { id?: string }) => {
      if (payload?.id) {
        const p = players.get(payload.id);
        if (p?.group) {
          scene.remove(p.group);
          disposeGroup(p.group);
        }
        players.delete(payload.id);
      }
    });
    if (socket.connected) socket.emit("join", { hint: mySeat });

    const sendState = () => {
      if (socket.connected) {
        socket.emit("state", {
          id: mySeat,
          x: me.x,
          y: me.z, // 2D-style y = our z
          a: me.angle,
          hp: me.hp,
          s: mouse.down,
        });
      }
    };
    const sendEvt = (msg: EvtMsg) => {
      if (socket.connected) socket.emit("evt", msg);
    };

    const hb = setInterval(() => {
      sendState();
    }, 1000);

    // ---- input ----
    const keys: Record<string, boolean> = {};
    const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2, down: false };
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

    // Raycaster for mouse→ground aim.
    const raycaster = new THREE.Raycaster();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ndc = new THREE.Vector2();
    const aimTarget = new THREE.Vector3();

    // ---- game loop ----
    let raf = 0;
    let last = performance.now();
    let running = true;
    let fireTimer = 0;
    let sendTimer = 0;
    let lastSent = { x: me.x, z: me.z, a: me.angle, hp: me.hp, s: false };
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

      // --- movement (world-relative WASD) ---
      if (!gameOverRef.current && me.hp > 0) {
        let dx = 0;
        let dz = 0;
        if (keys["w"] || keys["arrowup"]) dz -= 1;
        if (keys["s"] || keys["arrowdown"]) dz += 1;
        if (keys["a"] || keys["arrowleft"]) dx -= 1;
        if (keys["d"] || keys["arrowright"]) dx += 1;
        const len = Math.hypot(dx, dz);
        if (len > 0) {
          dx /= len;
          dz /= len;
          const nx = me.x + dx * PLAYER_SPEED * dt;
          const nz = me.z + dz * PLAYER_SPEED * dt;
          if (!blocked(nx, me.z, PLAYER_R)) me.x = nx;
          if (!blocked(me.x, nz, PLAYER_R)) me.z = nz;
        }
      }

      // --- aim (raycast mouse onto ground plane) ---
      ndc.x = (mouse.x / window.innerWidth) * 2 - 1;
      ndc.y = -(mouse.y / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.ray.intersectPlane(groundPlane, aimTarget)) {
        me.angle = Math.atan2(aimTarget.z - me.z, aimTarget.x - me.x);
      }

      // --- shooting ---
      fireTimer -= dt;
      if (!gameOverRef.current && me.hp > 0 && mouse.down && fireTimer <= 0) {
        fireTimer = FIRE_COOLDOWN;
        const bid = `${mySeat}-${now}-${Math.random().toString(36).slice(2, 6)}`;
        const bx = me.x + Math.cos(me.angle) * (PLAYER_R + 4);
        const bz = me.z + Math.sin(me.angle) * (PLAYER_R + 4);
        const m = new THREE.Mesh(bulletGeo, bulletMat);
        m.position.set(bx, 18, bz);
        scene.add(m);
        const b: Bullet = {
          id: bid,
          ownerId: mySeat,
          x: bx,
          z: bz,
          vx: Math.cos(me.angle) * BULLET_SPEED,
          vz: Math.sin(me.angle) * BULLET_SPEED,
          life: BULLET_LIFE,
          mesh: m,
        };
        myBullets.push(b);
        sendEvt({ t: "b", id: bid, o: mySeat, x: bx, y: bz, vx: b.vx, vy: b.vz });
        sendState();
      }

      // --- update my bullets ---
      for (let i = myBullets.length - 1; i >= 0; i--) {
        const b = myBullets[i];
        b.x += b.vx * dt;
        b.z += b.vz * dt;
        b.life -= dt;
        b.mesh.position.set(b.x, 18, b.z);
        let dead = b.life <= 0 || blocked(b.x, b.z, BULLET_R);
        for (const [, p] of players) {
          if (p.hp <= 0) continue;
          if (Math.hypot(b.x - p.x, b.z - p.z) < PLAYER_R + BULLET_R) {
            dead = true;
            p.hp = Math.max(0, p.hp - 12);
            spawnHitMarker(b.x, b.z);
            if (p.ring) {
              (p.ring.material as THREE.MeshBasicMaterial).color.setHex(hpRingColor(p.hp));
            }
            if (p.hp <= 0) {
              sendEvt({ t: "dead", id: p.id });
            }
            break;
          }
        }
        if (dead) {
          scene.remove(b.mesh);
          myBullets.splice(i, 1);
        }
      }

      // --- update remote bullets + check if they hit me ---
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx * dt;
        b.z += b.vz * dt;
        b.life -= dt;
        b.mesh.position.set(b.x, 18, b.z);
        let dead = b.life <= 0 || blocked(b.x, b.z, BULLET_R);
        if (!dead && me.hp > 0 && Math.hypot(b.x - me.x, b.z - me.z) < PLAYER_R + BULLET_R) {
          dead = true;
          me.hp = Math.max(0, me.hp - 12);
          setHp(me.hp);
          spawnHitMarker(b.x, b.z);
          if (me.hp <= 0) goDead();
        }
        if (dead) {
          scene.remove(b.mesh);
          bullets.splice(i, 1);
        }
      }

      // --- hit markers ---
      for (let i = hitMarkers.length - 1; i >= 0; i--) {
        const h = hitMarkers[i];
        h.life -= dt;
        const k = 1 - h.life / 0.3;
        h.mesh.scale.setScalar(1 + k * 2);
        (h.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, h.life / 0.3);
        if (h.life <= 0) {
          scene.remove(h.mesh);
          hitMarkers.splice(i, 1);
        }
      }

      // --- update local mesh ---
      myMesh.position.set(me.x, 0, me.z);
      myMesh.rotation.y = -me.angle;

      // --- update remote player meshes ---
      const cutoff = Date.now() - 6000;
      for (const [id, p] of players) {
        if (p.lastSeen < cutoff) {
          if (p.group) {
            scene.remove(p.group);
            disposeGroup(p.group);
          }
          players.delete(id);
          continue;
        }
        if (p.group) {
          // smooth toward the latest snapshot
          p.group.position.x += (p.x - p.group.position.x) * Math.min(1, dt * 12);
          p.group.position.z += (p.z - p.group.position.z) * Math.min(1, dt * 12);
          const targetRot = -p.angle;
          // shortest-arc lerp
          let dr = targetRot - p.group.rotation.y;
          while (dr > Math.PI) dr -= Math.PI * 2;
          while (dr < -Math.PI) dr += Math.PI * 2;
          p.group.rotation.y += dr * Math.min(1, dt * 12);
          p.group.position.y = 0;
        }
      }

      // partner-online indicator
      const online = players.size > 0;
      if (online !== partnerOnlineRef.current) {
        partnerOnlineRef.current = online;
        setPartnerOnline(online);
      }

      // --- network: send state ~10/s when something changed ---
      sendTimer -= dt;
      if (sendTimer <= 0) {
        sendTimer = 0.1;
        const moved =
          Math.abs(me.x - lastSent.x) > 0.5 ||
          Math.abs(me.z - lastSent.z) > 0.5 ||
          Math.abs(me.angle - lastSent.a) > 0.02 ||
          me.hp !== lastSent.hp ||
          mouse.down !== lastSent.s;
        if (moved) {
          lastSent = { x: me.x, z: me.z, a: me.angle, hp: me.hp, s: mouse.down };
          sendState();
        }
      }

      // --- camera follows local player ---
      camera.position.set(
        me.x + CAM_OFFSET.x,
        CAM_OFFSET.y,
        me.z + CAM_OFFSET.z
      );
      camera.lookAt(me.x + CAM_LOOK.x, CAM_LOOK.y, me.z + CAM_LOOK.z);

      // --- render 3D scene ---
      renderer.render(scene, camera);

      // --- minimap (2D canvas overlay) ---
      drawMinimap();

      raf = requestAnimationFrame(loop);
    };

    function spawnHitMarker(x: number, z: number) {
      const m = new THREE.Mesh(hitGeo, hitMat.clone());
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 1, z);
      scene.add(m);
      hitMarkers.push({ x, z, life: 0.3, mesh: m });
    }

    function drawMinimap() {
      const mm = minimapRef.current;
      if (!mm) return;
      const mctx = mm.getContext("2d");
      if (!mctx) return;
      const size = mm.width;
      const scale = size / WORLD_W;
      mctx.clearRect(0, 0, size, size);
      // bg
      mctx.fillStyle = "rgba(15, 12, 25, 0.82)";
      mctx.fillRect(0, 0, size, size);
      // buildings
      mctx.fillStyle = "rgba(58, 51, 88, 0.75)";
      for (const b of BUILDINGS) {
        mctx.fillRect(b.x * scale, b.y * scale, Math.max(1, b.w * scale), Math.max(1, b.h * scale));
      }
      // remote players
      for (const [, p] of players) {
        mctx.fillStyle = p.color;
        mctx.beginPath();
        mctx.arc(p.x * scale, p.z * scale, 3, 0, Math.PI * 2);
        mctx.fill();
      }
      // me (pulsing)
      const pulse = 3 + Math.sin(performance.now() / 200) * 1.5;
      mctx.fillStyle = me.color;
      mctx.beginPath();
      mctx.arc(me.x * scale, me.z * scale, Math.max(1.5, pulse), 0, Math.PI * 2);
      mctx.fill();
      // aim direction line
      mctx.strokeStyle = "rgba(253, 224, 71, 0.5)";
      mctx.lineWidth = 1;
      mctx.beginPath();
      mctx.moveTo(me.x * scale, me.z * scale);
      mctx.lineTo(
        (me.x + Math.cos(me.angle) * 60) * scale,
        (me.z + Math.sin(me.angle) * 60) * scale
      );
      mctx.stroke();
      // border
      mctx.strokeStyle = "rgba(167, 139, 250, 0.5)";
      mctx.lineWidth = 1;
      mctx.strokeRect(0.5, 0.5, size - 1, size - 1);
    }

    loop();

    // resize handler
    const resize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
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
      // dispose 3D resources
      scene.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) {
          const mat = m.material as THREE.Material | THREE.Material[];
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
          else mat.dispose();
        }
      });
      bulletGeo.dispose();
      bulletMat.dispose();
      hitGeo.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [myId]);

  const respawn = () => {
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black" style={{ cursor: "none" }}>
      {/* 3D canvas mounts here */}
      <div ref={containerRef} className="block h-full w-full" />

      {/* custom crosshair following the mouse */}
      <Crosshair />

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

      {/* minimap (top-right) */}
      <canvas
        ref={minimapRef}
        width={130}
        height={130}
        className="pointer-events-none absolute right-4 top-4 rounded-xl border border-violet-400/30 bg-black/40 backdrop-blur"
      />

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
        className="absolute bottom-4 right-4 grid h-10 w-10 place-items-center rounded-full bg-black/60 text-white backdrop-blur transition hover:bg-black/80"
        aria-label="Exit game"
        style={{ cursor: "pointer" }}
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
              style={{ cursor: "pointer" }}
            >
              Respawn
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Crosshair that follows the mouse, drawn as an HTML overlay. */
function Crosshair() {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const el = ref.current;
      if (!el) return;
      el.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute left-0 top-0 z-[210]"
      style={{ willChange: "transform" }}
    >
      <div className="relative -translate-x-1/2 -translate-y-1/2">
        <div
          className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-300/70"
        />
        <div className="absolute left-1/2 top-1/2 h-0.5 w-3 -translate-y-1/2 translate-x-2 bg-amber-300/80" />
        <div className="absolute left-1/2 top-1/2 h-0.5 w-3 -translate-y-1/2 -translate-x-5 bg-amber-300/80" />
        <div className="absolute left-1/2 top-1/2 h-3 w-0.5 -translate-x-1/2 translate-y-2 bg-amber-300/80" />
        <div className="absolute left-1/2 top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-5 bg-amber-300/80" />
      </div>
    </div>
  );
}

/** Update the color/name/outline of an already-built player mesh (used on seat change). */
function refreshMeshAppearance(group: THREE.Group, color: string, name: string, isMe: boolean) {
  group.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (!m.material) return;
    if (m.userData?.isHpRing) {
      (m.material as THREE.MeshBasicMaterial).color.set(isMe ? 0xffffff : new THREE.Color(color));
      return;
    }
    // body is the capsule (player color); gun stays yellow.
    if (m.geometry instanceof THREE.CapsuleGeometry) {
      (m.material as THREE.MeshStandardMaterial).color.set(new THREE.Color(color));
    }
  });
  // replace the name sprite
  const oldLabel = group.children.find((c) => c instanceof THREE.Sprite);
  if (oldLabel) {
    group.remove(oldLabel);
    (oldLabel.material as THREE.SpriteMaterial).map?.dispose();
    (oldLabel.material as THREE.SpriteMaterial).dispose();
  }
  const label = makeLabelSprite(name, isMe ? "#ffffff" : "#cbd5e1");
  label.position.y = 42;
  label.scale.set(48, 12, 1);
  group.add(label);
}

/** Dispose all geometries/materials inside a group. */
function disposeGroup(group: THREE.Group) {
  group.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    if (m.material) {
      const mat = m.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat.dispose();
    }
  });
}
