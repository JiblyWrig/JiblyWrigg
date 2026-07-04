"use client";

import { create } from "zustand";
import type { ChatMessage, FileType, UserId } from "./types";
import { PARTNER } from "./types";
import { getSupabase, isSupabaseConfigured } from "./supabase";

/* ----------------------------------------------------------------
 *  Backend abstraction
 * ---------------------------------------------------------------- */

interface BackendCallbacks {
  onMessage: (m: ChatMessage) => void;
  onUpdate: (m: ChatMessage) => void;
  onDelete: (id: string) => void;
  onReset: () => void;
  onPresence: (online: boolean) => void;
  onTyping: (typing: boolean) => void;
}

interface Backend {
  init(): void;
  sendMessage(m: ChatMessage): Promise<void>;
  markRead(ids: string[]): Promise<void>;
  markDelivered(ids: string[]): Promise<void>;
  setTyping(typing: boolean): void;
  resetChat(): Promise<void>;
  uploadFile(
    file: File
  ): Promise<{ url: string; type: FileType; name: string }>;
  deleteMessage(id: string): Promise<void>;
  togglePin(id: string, pinned: boolean): Promise<void>;
  claimIdentity(clientId: string): Promise<UserId>;
  destroy(): void;
}

/* ----------------------------------------------------------------
 *  Helpers
 * ---------------------------------------------------------------- */

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

function detectFileType(file: File): FileType {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
}

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/* ----------------------------------------------------------------
 *  Local backend — localStorage + BroadcastChannel (demo mode)
 * ---------------------------------------------------------------- */

const LS_MESSAGES = "lilac:messages";
const LS_CLAIMS = "lilac:claims";
const BC_NAME = "lilac-chat-v3";

type BcEvent =
  | { type: "msg"; message: ChatMessage }
  | { type: "update"; message: ChatMessage }
  | { type: "delete"; id: string }
  | { type: "reset" }
  | { type: "typing"; from: UserId; typing: boolean }
  | { type: "hello"; from: UserId };

interface ClaimEntry {
  userId: UserId;
  ts: number;
}

function lsReadMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(LS_MESSAGES);
    if (!raw) return [];
    const arr = JSON.parse(raw) as ChatMessage[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function lsWriteMessages(msgs: ChatMessage[]) {
  try {
    localStorage.setItem(LS_MESSAGES, JSON.stringify(msgs));
  } catch {
    /* quota — ignore */
  }
}

function lsReadClaims(): Record<string, ClaimEntry> {
  try {
    const raw = localStorage.getItem(LS_CLAIMS);
    if (!raw) return {};
    const obj = JSON.parse(raw) as Record<string, ClaimEntry>;
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function lsWriteClaims(claims: Record<string, ClaimEntry>) {
  try {
    localStorage.setItem(LS_CLAIMS, JSON.stringify(claims));
  } catch {
    /* ignore */
  }
}

class LocalBackend implements Backend {
  private myId: UserId;
  private cb: BackendCallbacks;
  private bc: BroadcastChannel | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private presencePoll: ReturnType<typeof setInterval> | null = null;
  private visibilityHandler: (() => void) | null = null;
  private storageHandler: ((e: StorageEvent) => void) | null = null;

  constructor(myId: UserId, cb: BackendCallbacks) {
    this.myId = myId;
    this.cb = cb;
  }

  init() {
    const msgs = lsReadMessages().sort((a, b) => a.created_at - b.created_at);
    msgs.forEach((m) => this.cb.onMessage(m));

    this.bc = new BroadcastChannel(BC_NAME);
    this.bc.onmessage = (e: MessageEvent<BcEvent>) => this.handle(e.data);

    this.writePresence();
    this.heartbeat = setInterval(() => this.writePresence(), 3000);
    this.presencePoll = setInterval(() => this.checkPresence(), 1500);

    this.storageHandler = (e: StorageEvent) => {
      if (e.key === `lilac:presence:${PARTNER[this.myId]}`) {
        this.checkPresence();
      }
    };
    window.addEventListener("storage", this.storageHandler);

    this.visibilityHandler = () => {
      if (document.visibilityState === "visible") this.checkPresence();
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);

    this.post({ type: "hello", from: this.myId });
  }

  private post(ev: BcEvent) {
    this.bc?.postMessage(ev);
  }

  private handle(ev: BcEvent) {
    if (!ev) return;
    switch (ev.type) {
      case "msg": {
        this.cb.onMessage(ev.message);
        if (ev.message.sender_id !== this.myId) {
          const updated: ChatMessage = {
            ...ev.message,
            delivered_at: Date.now(),
            read_at:
              document.visibilityState === "visible" ? Date.now() : null,
          };
          this.persistUpdate(updated);
          this.cb.onUpdate(updated);
          this.post({ type: "update", message: updated });
        }
        break;
      }
      case "update":
        this.cb.onUpdate(ev.message);
        break;
      case "delete":
        this.cb.onDelete(ev.id);
        break;
      case "reset":
        lsWriteMessages([]);
        this.cb.onReset();
        break;
      case "typing":
        if (ev.from !== this.myId) this.cb.onTyping(ev.typing);
        break;
      case "hello":
        this.writePresence();
        this.checkPresence();
        break;
    }
  }

  private persistUpdate(updated: ChatMessage) {
    const msgs = lsReadMessages();
    const idx = msgs.findIndex((m) => m.id === updated.id);
    if (idx >= 0) {
      msgs[idx] = { ...msgs[idx], ...updated };
      lsWriteMessages(msgs);
    }
  }

  async sendMessage(m: ChatMessage) {
    const msgs = lsReadMessages();
    msgs.push(m);
    // Cap at 40 messages — drop oldest beyond 40.
    while (msgs.length > 40) msgs.shift();
    lsWriteMessages(msgs);
    this.cb.onMessage(m);
    this.post({ type: "msg", message: m });
  }

  async markRead(ids: string[]) {
    if (!ids.length) return;
    const msgs = lsReadMessages();
    const now = Date.now();
    let changed = false;
    const updatedList: ChatMessage[] = [];
    for (const m of msgs) {
      if (ids.includes(m.id) && m.read_at == null) {
        m.read_at = now;
        changed = true;
        updatedList.push(m);
      }
    }
    if (changed) {
      lsWriteMessages(msgs);
      updatedList.forEach((u) => {
        this.cb.onUpdate(u);
        this.post({ type: "update", message: u });
      });
    }
  }

  async markDelivered(_ids: string[]) {
    // delivered status is handled on receipt in local mode
  }

  setTyping(typing: boolean) {
    this.post({ type: "typing", from: this.myId, typing });
  }

  async resetChat() {
    lsWriteMessages([]);
    this.cb.onReset();
    this.post({ type: "reset" });
  }

  async uploadFile(file: File) {
    const url = await fileToDataUrl(file);
    return { url, type: detectFileType(file), name: file.name };
  }

  async deleteMessage(id: string) {
    const msgs = lsReadMessages().filter((m) => m.id !== id);
    lsWriteMessages(msgs);
    this.cb.onDelete(id);
    this.post({ type: "delete", id });
  }

  async togglePin(id: string, pinned: boolean) {
    const msgs = lsReadMessages();
    const idx = msgs.findIndex((m) => m.id === id);
    if (idx >= 0) {
      msgs[idx] = { ...msgs[idx], pinned };
      lsWriteMessages(msgs);
      this.cb.onUpdate(msgs[idx]);
      this.post({ type: "update", message: msgs[idx] });
    }
  }

  async claimIdentity(clientId: string): Promise<UserId> {
    const claims = lsReadClaims();
    const existing = claims[clientId];
    if (existing) return existing.userId;

    const taken = new Set(Object.values(claims).map((c) => c.userId));
    let chosen: UserId;
    if (!taken.has("user1")) chosen = "user1";
    else if (!taken.has("user2")) chosen = "user2";
    else {
      // both claimed — evict the oldest claim and take its slot
      let oldestId = "";
      let oldestTs = Infinity;
      for (const [cid, c] of Object.entries(claims)) {
        if (c.ts < oldestTs) {
          oldestTs = c.ts;
          oldestId = cid;
        }
      }
      chosen = claims[oldestId]?.userId === "user1" ? "user1" : "user2";
      delete claims[oldestId];
    }
    claims[clientId] = { userId: chosen, ts: Date.now() };
    lsWriteClaims(claims);
    return chosen;
  }

  private writePresence() {
    try {
      localStorage.setItem(
        `lilac:presence:${this.myId}`,
        String(Date.now())
      );
    } catch {
      /* ignore */
    }
  }

  private checkPresence() {
    try {
      const raw = localStorage.getItem(
        `lilac:presence:${PARTNER[this.myId]}`
      );
      const online = raw ? Date.now() - Number(raw) < 8000 : false;
      this.cb.onPresence(online);
    } catch {
      this.cb.onPresence(false);
    }
  }

  destroy() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.presencePoll) clearInterval(this.presencePoll);
    if (this.storageHandler)
      window.removeEventListener("storage", this.storageHandler);
    if (this.visibilityHandler)
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    this.bc?.close();
    try {
      localStorage.removeItem(`lilac:presence:${this.myId}`);
    } catch {
      /* ignore */
    }
  }
}

/* ----------------------------------------------------------------
 *  Supabase backend — real cross-device 2-person chat
 * ---------------------------------------------------------------- */

class SupabaseBackend implements Backend {
  private myId: UserId;
  private cb: BackendCallbacks;
  private channel: ReturnType<
    NonNullable<ReturnType<typeof getSupabase>>["channel"]
  > | null = null;
  private presenceChannel: ReturnType<
    NonNullable<ReturnType<typeof getSupabase>>["channel"]
  > | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(myId: UserId, cb: BackendCallbacks) {
    this.myId = myId;
    this.cb = cb;
  }

  private get sb() {
    return getSupabase()!;
  }

  init() {
    this.sb
      .from("messages")
      .select("*")
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        (data ?? []).forEach((row) => this.cb.onMessage(this.fromRow(row)));
      });

    this.channel = this.sb
      .channel("lilac-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const m = this.fromRow(payload.new as Record<string, unknown>);
          this.cb.onMessage(m);
          if (m.sender_id !== this.myId) {
            const patch: Partial<ChatMessage> = {
              delivered_at: Date.now(),
              read_at:
                document.visibilityState === "visible" ? Date.now() : null,
            };
            this.sb.from("messages").update(patch).eq("id", m.id).then();
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        (payload) => {
          this.cb.onUpdate(
            this.fromRow(payload.new as Record<string, unknown>)
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages" },
        (payload) => {
          const old = payload.old as Record<string, unknown> | null;
          if (old && old.id) this.cb.onDelete(String(old.id));
        }
      )
      .subscribe();

    this.presenceChannel = this.sb.channel("lilac-presence", {
      config: { presence: { key: this.myId } },
    });

    this.presenceChannel
      .on("presence", { event: "sync" }, () => {
        const state = this.presenceChannel!.presenceState();
        const partnerId = PARTNER[this.myId];
        const online = Object.keys(state).includes(partnerId);
        this.cb.onPresence(online);
      })
      .on(
        "broadcast",
        { event: "typing" },
        (payload: { payload?: { from?: UserId; typing?: boolean } }) => {
          const p = payload.payload;
          if (p && p.from !== this.myId) this.cb.onTyping(!!p.typing);
        }
      )
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await this.presenceChannel!.track({ id: this.myId });
        }
      });

    this.heartbeat = setInterval(async () => {
      if (this.presenceChannel) {
        await this.presenceChannel.track({ id: this.myId });
      }
    }, 25000);
  }

  private fromRow(row: Record<string, unknown>): ChatMessage {
    return {
      id: String(row.id),
      sender_id: row.sender_id as UserId,
      content: (row.content as string) ?? "",
      file_url: (row.file_url as string) ?? null,
      file_type: (row.file_type as FileType) ?? null,
      file_name: (row.file_name as string) ?? null,
      created_at: Number(row.created_at) || Date.now(),
      read_at: row.read_at ? Number(row.read_at) : null,
      delivered_at: row.delivered_at ? Number(row.delivered_at) : null,
      sticker: (row.sticker as string) ?? null,
      pinned: Boolean(row.pinned),
      reply_to: (row.reply_to as string) ?? null,
    };
  }

  async sendMessage(m: ChatMessage) {
    await this.sb.from("messages").insert({
      id: m.id,
      sender_id: m.sender_id,
      content: m.content,
      file_url: m.file_url,
      file_type: m.file_type,
      file_name: m.file_name,
      created_at: m.created_at,
      sticker: m.sticker,
      pinned: m.pinned ?? false,
      reply_to: m.reply_to ?? null,
    });
    this.cb.onMessage(m);
    // Cap stored messages at 40 to save space — delete oldest beyond 40.
    this.capMessages().catch(() => {});
  }

  /** Delete all but the newest 40 messages to keep storage small. */
  private async capMessages() {
    const { data } = await this.sb
      .from("messages")
      .select("id, created_at")
      .order("created_at", { ascending: false })
      .limit(41);
    if (!data || data.length <= 40) return;
    // data[40] is the 41st newest — delete it and everything older
    const cutoff = Number(data[40].created_at);
    await this.sb
      .from("messages")
      .delete()
      .lt("created_at", cutoff);
  }

  async markRead(ids: string[]) {
    if (!ids.length) return;
    await this.sb
      .from("messages")
      .update({ read_at: Date.now() })
      .in("id", ids)
      .eq("sender_id", PARTNER[this.myId]);
  }

  async markDelivered(ids: string[]) {
    if (!ids.length) return;
    await this.sb
      .from("messages")
      .update({ delivered_at: Date.now() })
      .in("id", ids)
      .eq("sender_id", PARTNER[this.myId]);
  }

  setTyping(typing: boolean) {
    this.presenceChannel?.send({
      type: "broadcast",
      event: "typing",
      payload: { from: this.myId, typing },
    });
  }

  async resetChat() {
    await this.sb
      .from("messages")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    this.cb.onReset();
  }

  async uploadFile(file: File) {
    const ext = file.name.split(".").pop() || "bin";
    const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await this.sb.storage
      .from("chat-files")
      .upload(path, file, { cacheControl: "3600", upsert: false });
    if (error) throw error;
    const { data } = this.sb.storage.from("chat-files").getPublicUrl(path);
    return { url: data.publicUrl, type: detectFileType(file), name: file.name };
  }

  async deleteMessage(id: string) {
    await this.sb.from("messages").delete().eq("id", id);
    this.cb.onDelete(id);
  }

  async togglePin(id: string, pinned: boolean) {
    await this.sb.from("messages").update({ pinned }).eq("id", id);
  }

  async claimIdentity(clientId: string): Promise<UserId> {
    // already claimed?
    const { data: mine } = await this.sb
      .from("device_claims")
      .select("user_id")
      .eq("client_id", clientId)
      .maybeSingle();
    if (mine?.user_id) return mine.user_id as UserId;

    // who's taken?
    const { data: existing } = await this.sb
      .from("device_claims")
      .select("user_id");
    const taken = new Set((existing ?? []).map((r) => r.user_id as string));

    const tryClaim = async (userId: UserId) => {
      const { error } = await this.sb.from("device_claims").insert({
        client_id: clientId,
        user_id: userId,
        claimed_at: Date.now(),
      });
      return !error;
    };

    if (!taken.has("user1") && (await tryClaim("user1"))) return "user1";
    if (!taken.has("user2") && (await tryClaim("user2"))) return "user2";

    // both taken (race / stale) — fall back to user2 for this device
    return "user2";
  }

  destroy() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.channel?.unsubscribe();
    this.presenceChannel?.unsubscribe();
  }
}

/* ----------------------------------------------------------------
 *  Zustand store
 * ---------------------------------------------------------------- */

interface ChatStore {
  myId: UserId | null;
  messages: ChatMessage[];
  partnerOnline: boolean;
  partnerTyping: boolean;
  initialized: boolean;
  replyTo: ChatMessage | null;

  resolveIdentity: (clientId: string) => Promise<UserId>;
  init: (myId: UserId) => void;
  destroy: () => void;
  send: (input: {
    content: string;
    file?: File | null;
    sticker?: string | null;
    replyToId?: string | null;
  }) => Promise<void>;
  markPartnerUnreadAsRead: () => void;
  setTyping: (typing: boolean) => void;
  resetChat: () => Promise<void>;
  deleteMessage: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  setReplyTo: (m: ChatMessage | null) => void;
}

let backendRef: Backend | null = null;

function makeBackend(myId: UserId, cb: BackendCallbacks): Backend {
  if (isSupabaseConfigured) return new SupabaseBackend(myId, cb);
  return new LocalBackend(myId, cb);
}

export const useChatStore = create<ChatStore>((set, get) => ({
  myId: null,
  messages: [],
  partnerOnline: false,
  partnerTyping: false,
  initialized: false,
  replyTo: null,

  resolveIdentity: async (clientId) => {
    // claim needs a backend instance; create a transient one for claiming.
    // We use a throwaway callbacks set; init() will create the real one.
    const cb: BackendCallbacks = {
      onMessage: () => {},
      onUpdate: () => {},
      onDelete: () => {},
      onReset: () => {},
      onPresence: () => {},
      onTyping: () => {},
    };
    const tmp = makeBackend("user1", cb);
    try {
      return await tmp.claimIdentity(clientId);
    } finally {
      tmp.destroy();
    }
  },

  init: (myId) => {
    if (get().initialized) return;
    const cb: BackendCallbacks = {
      onMessage: (m) => {
        const existing = get().messages.find((x) => x.id === m.id);
        if (existing) {
          set((s) => ({
            messages: s.messages.map((x) =>
              x.id === m.id ? { ...x, ...m } : x
            ),
          }));
        } else {
          // Append in arrival order — do NOT sort by created_at.
          // Clocks differ between devices, so created_at can misorder.
          // Initial history load is DB-ordered ascending; realtime INSERTs
          // arrive in commit order. Cap at 40 to match the storage cap.
          set((s) => {
            const next = [...s.messages, m];
            while (next.length > 40) next.shift();
            return { messages: next };
          });
        }
      },
      onUpdate: (m) => {
        set((s) => ({
          messages: s.messages.map((x) =>
            x.id === m.id ? { ...x, ...m } : x
          ),
        }));
      },
      onDelete: (id) => {
        set((s) => ({
          messages: s.messages.filter((x) => x.id !== id),
          replyTo:
            s.replyTo?.id === id ? null : s.replyTo,
        }));
      },
      onReset: () => set({ messages: [], replyTo: null }),
      onPresence: (online) => {
        if (online !== get().partnerOnline) set({ partnerOnline: online });
      },
      onTyping: (typing) => {
        set({ partnerTyping: typing });
        if (typing) {
          window.setTimeout(() => {
            if (get().partnerTyping) set({ partnerTyping: false });
          }, 3500);
        }
      },
    };
    backendRef = makeBackend(myId, cb);
    backendRef.init();
    set({ myId, initialized: true });
  },

  destroy: () => {
    backendRef?.destroy();
    backendRef = null;
    set({
      myId: null,
      messages: [],
      partnerOnline: false,
      partnerTyping: false,
      initialized: false,
      replyTo: null,
    });
  },

  send: async ({ content, file, sticker, replyToId }) => {
    const myId = get().myId;
    const backend = backendRef;
    if (!myId || !backend) return;
    let file_url: string | null = null;
    let file_type: FileType = null;
    let file_name: string | null = null;
    if (file) {
      try {
        const up = await backend.uploadFile(file);
        file_url = up.url;
        file_type = up.type;
        file_name = up.name;
      } catch {
        /* ignore upload errors */
      }
    }
    const msg: ChatMessage = {
      id: uid(),
      sender_id: myId,
      content: content.trim(),
      file_url,
      file_type,
      file_name,
      created_at: Date.now(),
      read_at: null,
      delivered_at: null,
      sticker: sticker ?? null,
      pinned: false,
      reply_to: replyToId ?? null,
    };
    await backend.sendMessage(msg);
    set({ replyTo: null });
  },

  markPartnerUnreadAsRead: () => {
    const { myId, messages } = get();
    const backend = backendRef;
    if (!myId || !backend) return;
    const unread = messages.filter(
      (m) => m.sender_id !== myId && m.read_at == null
    );
    if (unread.length) {
      backend.markRead(unread.map((m) => m.id));
    }
  },

  setTyping: (typing) => {
    backendRef?.setTyping(typing);
  },

  resetChat: async () => {
    const backend = backendRef;
    if (!backend) return;
    await backend.resetChat();
  },

  deleteMessage: async (id) => {
    const backend = backendRef;
    if (!backend) return;
    await backend.deleteMessage(id);
  },

  togglePin: async (id) => {
    const backend = backendRef;
    const msgs = get().messages;
    const target = msgs.find((m) => m.id === id);
    if (!backend || !target) return;
    const next = !target.pinned;
    // optimistic local update
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, pinned: next } : m
      ),
    }));
    await backend.togglePin(id, next);
  },

  setReplyTo: (m) => set({ replyTo: m }),
}));
