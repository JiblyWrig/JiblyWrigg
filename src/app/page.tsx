"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useChatStore } from "@/lib/chat-store";
import { IDENTITIES, type UserId } from "@/lib/types";
import { getClientId } from "@/lib/identity";
import { ChatHeader } from "@/components/chat-header";
import { MessageList } from "@/components/message-list";
import { MessageInput } from "@/components/message-input";
import { SelfieCapture } from "@/components/selfie-capture";
import { PasswordGate } from "@/components/password-gate";
import { GtaGame } from "@/components/gta-game";

export default function Home() {
  return (
    <PasswordGate>
      <ChatApp />
    </PasswordGate>
  );
}

function ChatApp() {
  const [myId, setMyId] = React.useState<UserId | null>(null);
  const [resolving, setResolving] = React.useState(true);
  const [selfieOpen, setSelfieOpen] = React.useState(false);
  const [gameOpen, setGameOpen] = React.useState(false);
  const [gameKey, setGameKey] = React.useState(0);

  const {
    messages,
    partnerTyping,
    initialized,
    init,
    destroy,
    send,
    markPartnerUnreadAsRead,
    setTyping,
    resetChat,
    resolveIdentity,
  } = useChatStore();

  // Auto-assign a persistent per-device identity (no manual choosing).
  React.useEffect(() => {
    let cancelled = false;
    const id = getClientId();
    resolveIdentity(id)
      .then((userId) => {
        if (cancelled) return;
        setMyId(userId);
        setResolving(false);
      })
      .catch(() => {
        if (cancelled) return;
        setMyId("user1");
        setResolving(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resolveIdentity]);

  // init / destroy backend when identity resolves
  React.useEffect(() => {
    if (myId) {
      init(myId);
      return () => destroy();
    }
  }, [myId, init, destroy]);

  // read receipts: mark partner's unread as read when we're visible
  React.useEffect(() => {
    if (!initialized || !myId) return;
    const mark = () => {
      if (document.visibilityState === "visible") {
        markPartnerUnreadAsRead();
      }
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    window.addEventListener("focus", mark);
    const t = setInterval(mark, 4000);
    return () => {
      document.removeEventListener("visibilitychange", mark);
      window.removeEventListener("focus", mark);
      clearInterval(t);
    };
  }, [initialized, myId, messages.length, markPartnerUnreadAsRead]);

  const handleSend = async (input: {
    content: string;
    file?: File | null;
    replyToId?: string | null;
  }) => {
    await send(input);
  };

  const handleSelfieCapture = async (file: File) => {
    await send({ content: "", file });
    toast.success("Selfie sent 💜");
  };

  const handleReset = async () => {
    await resetChat();
    toast.success("Chat reset — a fresh start ✨");
  };

  if (resolving || !myId) {
    return (
      <div className="relative grid h-[100dvh] place-items-center bg-background">
        <FloatingHearts />
        <div className="relative z-10 flex flex-col items-center gap-3">
          <motion.div
            animate={{ scale: [1, 1.15, 1] }}
            transition={{ duration: 1.4, repeat: Infinity }}
            className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-violet-400 to-pink-400 text-2xl shadow-lg"
          >
            💜
          </motion.div>
          <p className="text-sm text-muted-foreground">Opening our space…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-background">
      {/* floating decorative purple hearts */}
      <FloatingHearts />

      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <ChatHeader
          partnerName={IDENTITIES[myId === "user1" ? "user2" : "user1"].name}
          onReset={handleReset}
        />

        <MessageList
          messages={messages}
          myId={myId}
          partnerTyping={partnerTyping}
        />

        <MessageInput
          onSend={handleSend}
          onTyping={setTyping}
          onSelfie={() => setSelfieOpen(true)}
        />
      </div>

      <SelfieCapture
        open={selfieOpen}
        onClose={() => setSelfieOpen(false)}
        onCapture={handleSelfieCapture}
      />

      {/* GTA game launch button — bottom-left corner */}
      {!gameOpen && (
        <motion.button
          type="button"
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          whileHover={{ scale: 1.1, rotate: -8 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => {
            setGameKey((k) => k + 1);
            setGameOpen(true);
          }}
          aria-label="Play GTA"
          title="Play GTA"
          className="fixed bottom-5 left-5 z-30 grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-pink-500 text-white shadow-lg shadow-fuchsia-500/30"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
            <path d="M7 5h3l1 2h2v3h-1l1 3h-2l-1-2H8l-1 2H5l1-3H5V7h2V5zm9 2h2v6h-2V7zM5 14h14v2H5v-2z"/>
          </svg>
        </motion.button>
      )}

      {/* GTA game overlay — covers everything, pausing all chat functionality */}
      {gameOpen && myId && (
        <GtaGame
          key={gameKey}
          myId={myId}
          onClose={() => setGameOpen(false)}
        />
      )}
    </div>
  );
}

function FloatingHearts() {
  // All purple hearts. Slow + very transparent.
  // base duration 11–14s, ×1.56 (slowed ~20% over the previous ×1.3).
  // peak opacity 0.32 (extra-transparent).
  const hearts = React.useMemo(
    () =>
      Array.from({ length: 7 }).map((_, i) => ({
        left: `${(i * 13 + 8) % 95}%`,
        delay: (i * 1.7) % 9,
        duration: (11 + (i % 4) * 3) * 1.56,
        size: 14 + (i % 3) * 6,
      })),
    []
  );

  return (
    <div
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      aria-hidden
    >
      {hearts.map((h, i) => (
        <motion.span
          key={i}
          initial={{ y: "110vh", opacity: 0 }}
          animate={{ y: "-15vh", opacity: [0, 0.32, 0.32, 0] }}
          transition={{
            duration: h.duration,
            delay: h.delay,
            repeat: Infinity,
            ease: "linear",
          }}
          style={{ left: h.left, fontSize: h.size, position: "absolute" }}
          className="select-none"
        >
          💜
        </motion.span>
      ))}
    </div>
  );
}
