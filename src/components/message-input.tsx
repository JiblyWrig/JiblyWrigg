"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Smile, Paperclip, Camera, Send, X, Reply as ReplyIcon } from "lucide-react";
import { EmojiPicker } from "./emoji-picker";
import { useChatStore } from "@/lib/chat-store";
import { IDENTITIES } from "@/lib/types";
import { cn } from "@/lib/utils";

export function MessageInput({
  onSend,
  onTyping,
  onSelfie,
  disabled,
}: {
  onSend: (input: {
    content: string;
    file?: File | null;
    replyToId?: string | null;
  }) => void;
  onTyping: (typing: boolean) => void;
  onSelfie: () => void;
  disabled?: boolean;
}) {
  const [text, setText] = React.useState("");
  const [showEmoji, setShowEmoji] = React.useState(false);
  const [pendingFile, setPendingFile] = React.useState<File | null>(null);
  const [textChars, setTextChars] = React.useState<{ ch: string; id: number; fresh: boolean }[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const textRef = React.useRef<HTMLTextAreaElement>(null);
  const emojiWrapRef = React.useRef<HTMLDivElement>(null);
  const typingTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = React.useRef(false);
  const charIdRef = React.useRef(0);

  const replyTo = useChatStore((s) => s.replyTo);
  const setReplyTo = useChatStore((s) => s.setReplyTo);

  // Close emoji menu when clicking outside of it.
  React.useEffect(() => {
    if (!showEmoji) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const el = emojiWrapRef.current;
      if (el && !el.contains(e.target as Node)) {
        setShowEmoji(false);
      }
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("touchstart", onDown, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("touchstart", onDown, true);
    };
  }, [showEmoji]);

  const autoGrow = () => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  };

  const handleChange = (v: string) => {
    // Maintain a per-character array for the rendered text layer.
    // When a single char is appended at the end, mark it fresh (triggers pop).
    // On deletion/paste/mid-string edits, rebuild from scratch (no pop).
    setTextChars((prev) => {
      const prevStr = prev.map((c) => c.ch).join("");
      if (v.length === prev.length + 1 && v.slice(0, prev.length) === prevStr) {
        const ch = v.slice(-1);
        charIdRef.current += 1;
        return [
          ...prev.map((c) => ({ ...c, fresh: false })),
          { ch, id: charIdRef.current, fresh: true },
        ];
      }
      // otherwise rebuild (deletion, paste, etc.) — no pop
      return v.split("").map((ch) => {
        charIdRef.current += 1;
        return { ch, id: charIdRef.current, fresh: false };
      });
    });
    setText(v);
    autoGrow();
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      onTyping(true);
    }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      isTypingRef.current = false;
      onTyping(false);
    }, 2200);
  };

  const flushTyping = () => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (isTypingRef.current) {
      isTypingRef.current = false;
      onTyping(false);
    }
  };

  const submit = () => {
    if (disabled) return;
    if (!text.trim() && !pendingFile) return;
    onSend({
      content: text,
      file: pendingFile,
      replyToId: replyTo?.id ?? null,
    });
    setText("");
    setPendingFile(null);
    setTextChars([]);
    autoGrow();
    flushTyping();
    setTimeout(() => textRef.current?.focus(), 0);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onPickEmoji = (e: string) => {
    setText((t) => t + e);
    // rebuild chars without pop for emoji inserts
    setTextChars((prev) => {
      const next = (prev.map((c) => c.ch).join("") + e).split("").map((ch) => {
        charIdRef.current += 1;
        return { ch, id: charIdRef.current, fresh: false };
      });
      return next;
    });
    textRef.current?.focus();
    setTimeout(autoGrow, 0);
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setPendingFile(f);
    e.target.value = "";
  };

  const canSend = (text.trim().length > 0 || !!pendingFile) && !disabled;

  const replyPreview = replyTo
    ? replyTo.sticker ||
      (replyTo.file_url
        ? replyTo.file_type === "image"
          ? "📷 Photo"
          : replyTo.file_type === "video"
          ? "🎥 Video"
          : replyTo.file_type === "audio"
          ? "🎵 Audio"
          : "📎 File"
        : replyTo.content) || "Message"
    : "";

  return (
    <div className="relative z-20 px-3 pb-3 pt-1 sm:px-5">
      <div className="mx-auto max-w-2xl">
        {/* reply preview */}
        <AnimatePresence>
          {replyTo && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.96 }}
              className="mb-2 flex items-center gap-2 rounded-2xl border border-primary/30 bg-card/90 py-1.5 pl-3 pr-2 text-xs shadow-sm backdrop-blur"
            >
              <ReplyIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-primary">
                  Replying to {IDENTITIES[replyTo.sender_id].name}
                </span>
                <span className="ml-1.5 truncate text-muted-foreground">
                  {replyPreview}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* pending file chip */}
        <AnimatePresence>
          {pendingFile && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="mb-2 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/90 py-1.5 pl-2 pr-3 text-xs shadow-sm backdrop-blur"
            >
              {pendingFile.type.startsWith("image/") ? (
                <img
                  src={URL.createObjectURL(pendingFile)}
                  alt=""
                  className="h-7 w-7 rounded-md object-cover"
                />
              ) : (
                <span className="grid h-7 w-7 place-items-center rounded-md bg-primary/15 text-primary">
                  <Paperclip className="h-3.5 w-3.5" />
                </span>
              )}
              <span className="max-w-[10rem] truncate font-medium">
                {pendingFile.name}
              </span>
              <button
                type="button"
                onClick={() => setPendingFile(null)}
                className="grid h-5 w-5 place-items-center rounded-full bg-secondary text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* emoji popover */}
        <AnimatePresence>
          {showEmoji && (
            <motion.div
              ref={emojiWrapRef}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute bottom-[5.5rem] left-3 z-30 sm:left-5"
            >
              <div className="relative">
                <EmojiPicker onPick={onPickEmoji} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* input row */}
        <div className="glass-panel flex items-end gap-1.5 rounded-[1.75rem] border border-border/60 p-1.5 shadow-lg shadow-primary/5">
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setShowEmoji((s) => !s)}
            className={cn(
              "grid h-10 w-10 shrink-0 place-items-center rounded-full transition-all",
              showEmoji
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
            title="Emoji"
          >
            <Smile className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-all hover:bg-secondary hover:text-foreground"
            title="Attach file"
          >
            <Paperclip className="h-5 w-5" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.txt,.zip"
            onChange={onPickFile}
          />

          <button
            type="button"
            onClick={onSelfie}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-all hover:bg-secondary hover:text-foreground"
            title="Take a selfie"
          >
            <Camera className="h-5 w-5" />
          </button>

          <div className="relative flex-1">
            {/* The real textarea — transparent text (caret still visible),
                handles all input. */}
            <textarea
              ref={textRef}
              rows={1}
              value={text}
              disabled={disabled}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder=""
              className="max-h-[140px] w-full resize-none bg-transparent px-2 py-2.5 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
              style={{ color: "transparent", caretColor: "var(--foreground)" }}
            />
            {/* Rendered text layer — each character is its own span flowing
                inline, so positions are always correct. Newly-typed chars
                pop (scale 2.2 → 1) in place; they never fall behind because
                they live in normal flow, not at fixed offsets. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 px-2 py-2.5 text-[15px] leading-relaxed text-foreground"
              style={{ fontFamily: "inherit", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
            >
              {textChars.map((c) => (
                <motion.span
                  key={c.id}
                  initial={c.fresh ? { scale: 2.2 } : false}
                  animate={{ scale: 1 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  style={{ display: "inline-block", transformOrigin: "left center" }}
                >
                  {c.ch}
                </motion.span>
              ))}
            </div>
          </div>

          <motion.button
            type="button"
            onClick={submit}
            disabled={!canSend}
            whileTap={canSend ? { scale: 0.85 } : {}}
            whileHover={canSend ? { scale: 1.05 } : {}}
            className={cn(
              "grid h-10 w-10 shrink-0 place-items-center rounded-full transition-all",
              canSend
                ? "bg-gradient-to-br from-violet-500 to-pink-500 text-white shadow-md shadow-fuchsia-400/30"
                : "bg-muted text-muted-foreground"
            )}
            title="Send"
          >
            <Send className="h-[18px] w-[18px]" />
          </motion.button>
        </div>
      </div>
    </div>
  );
}
