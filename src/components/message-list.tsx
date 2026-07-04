"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Heart, Pin } from "lucide-react";
import type { ChatMessage, UserId } from "@/lib/types";
import { IDENTITIES } from "@/lib/types";
import { MessageBubble } from "./message-bubble";
import { useChatStore } from "@/lib/chat-store";
import { cn } from "@/lib/utils";

function dayLabel(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString([], {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

function TypingBubble({ partnerId }: { partnerId: UserId }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.9 }}
      className="flex items-end gap-2"
    >
      <div
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br text-base shadow-sm",
          IDENTITIES[partnerId].color
        )}
      >
        {IDENTITIES[partnerId].avatar}
      </div>
      <div className="bubble-received flex items-center gap-1 rounded-3xl rounded-bl-md px-4 py-3.5">
        <span className="typing-dot" style={{ animationDelay: "0ms" }} />
        <span className="typing-dot" style={{ animationDelay: "180ms" }} />
        <span className="typing-dot" style={{ animationDelay: "360ms" }} />
      </div>
    </motion.div>
  );
}

function PinnedBar({ pinned }: { pinned: ChatMessage[] }) {
  const setReplyTo = useChatStore((s) => s.setReplyTo);
  const [expanded, setExpanded] = React.useState(false);
  if (pinned.length === 0) return null;
  const shown = expanded ? pinned : pinned.slice(0, 1);
  return (
    <div className="sticky top-0 z-20 mx-auto w-full max-w-2xl px-3 pt-2 sm:px-5">
      <div className="glass-panel overflow-hidden rounded-2xl border border-primary/30 shadow-md">
        <div className="flex items-center justify-between px-3 py-1.5">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-primary">
            <Pin className="h-3 w-3" /> Pinned · {pinned.length}
          </span>
          {pinned.length > 1 && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              {expanded ? "Show less" : `Show ${pinned.length - 1} more`}
            </button>
          )}
        </div>
        <div className="flex flex-col gap-1 px-3 pb-2">
          <AnimatePresence initial={false}>
            {shown.map((m) => (
              <motion.button
                key={m.id}
                type="button"
                onClick={() => setReplyTo(m)}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-2 rounded-lg bg-primary/5 px-2 py-1 text-left text-[12px] hover:bg-primary/10"
              >
                <span className="font-medium text-primary">
                  {IDENTITIES[m.sender_id].name}:
                </span>
                <span className="truncate text-muted-foreground">
                  {m.sticker ||
                    (m.file_url
                      ? m.file_type === "image"
                        ? "📷 Photo"
                        : "📎 File"
                      : m.content) ||
                    "Message"}
                </span>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export function MessageList({
  messages,
  myId,
  partnerTyping,
}: {
  messages: ChatMessage[];
  myId: UserId;
  partnerTyping: boolean;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = React.useState(true);

  const setReplyTo = useChatStore((s) => s.setReplyTo);
  const togglePin = useChatStore((s) => s.togglePin);
  const deleteMessage = useChatStore((s) => s.deleteMessage);

  const jumpToMessage = (id: string) => {
    const el = document.querySelector(`[data-msg-id="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("msg-flash");
    // force reflow so the animation restarts
    void (el as HTMLElement).offsetWidth;
    el.classList.add("msg-flash");
    window.setTimeout(() => el.classList.remove("msg-flash"), 1600);
  };

  const messagesById = React.useMemo(() => {
    const map = new Map<string, ChatMessage>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  const pinned = messages.filter((m) => m.pinned);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAtBottom(dist < 120);
  };

  React.useEffect(() => {
    if (atBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages.length, partnerTyping, atBottom]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, []);

  const days = messages.map((m) => dayLabel(m.created_at));
  const rows = messages.map((m, i) => {
    const day = days[i];
    const showDay = i === 0 || day !== days[i - 1];
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const mine = m.sender_id === myId;
    const groupedTop = !!prev && prev.sender_id === m.sender_id && !showDay;
    return { m, day, showDay, mine, groupedTop };
  });

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="relative z-10 flex-1 overflow-y-auto px-3 py-4 sm:px-5"
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-2.5">
        <PinnedBar pinned={pinned} />

        {messages.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto mt-10 flex max-w-xs flex-col items-center gap-3 rounded-3xl border border-border/50 bg-card/60 p-7 text-center backdrop-blur"
          >
            <motion.div
              animate={{ scale: [1, 1.12, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-violet-400 to-pink-400 text-white shadow-lg"
            >
              <Heart className="h-7 w-7 fill-white" />
            </motion.div>
            <p className="text-sm font-medium">Say hello to start your chat</p>
            <p className="text-xs text-muted-foreground">
              Messages, photos, selfies & emojis — all just for the two of you.
            </p>
          </motion.div>
        )}

        <AnimatePresence initial={false}>
          {rows.map(({ m, day, showDay, mine, groupedTop }) => (
            <React.Fragment key={m.id}>
              {showDay && (
                <div className="sticky top-1 z-10 mx-auto my-2">
                  <span className="rounded-full border border-border/50 bg-card/80 px-3 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur">
                    {day}
                  </span>
                </div>
              )}
              <div
                data-msg-id={m.id}
                className={cn(groupedTop ? "mt-0.5" : "mt-1.5")}
              >
                <MessageBubble
                  m={m}
                  mine={mine}
                  replyOriginal={
                    m.reply_to ? messagesById.get(m.reply_to) : undefined
                  }
                  onReply={() => setReplyTo(m)}
                  onPin={() => togglePin(m.id)}
                  onDelete={() => deleteMessage(m.id)}
                  onJumpTo={jumpToMessage}
                />
              </div>
            </React.Fragment>
          ))}
        </AnimatePresence>

        <AnimatePresence>
          {partnerTyping && <TypingBubble partnerId={m_partner(myId)} />}
        </AnimatePresence>

        <div ref={bottomRef} className="h-1" />
      </div>
    </div>
  );
}

function m_partner(myId: UserId): UserId {
  return myId === "user1" ? "user2" : "user1";
}
