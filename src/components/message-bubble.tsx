"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { FileText, Download, Play, Reply as ReplyIcon } from "lucide-react";
import type { ChatMessage } from "@/lib/types";
import { IDENTITIES } from "@/lib/types";
import { isEmojiOnly } from "@/lib/emojis";
import { MessageActions } from "./message-actions";
import { cn } from "@/lib/utils";

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function FileBlock({ m, mine }: { m: ChatMessage; mine: boolean }) {
  const [playing, setPlaying] = React.useState(false);
  if (!m.file_url) return null;

  if (m.file_type === "image") {
    // plain image — no new-tab link
    return (
      <motion.img
        src={m.file_url}
        alt={m.file_name || "photo"}
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="max-h-72 w-full max-w-[18rem] rounded-2xl object-cover"
        draggable={false}
      />
    );
  }
  if (m.file_type === "video") {
    return (
      <div className="relative max-w-[18rem] overflow-hidden rounded-2xl">
        <video
          src={m.file_url}
          controls={playing}
          className="max-h-72 w-full rounded-2xl object-cover"
          onPlay={() => setPlaying(true)}
        />
        {!playing && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              const v = e.currentTarget.previousElementSibling as HTMLVideoElement;
              v.play();
              setPlaying(true);
            }}
            className="absolute inset-0 grid place-items-center bg-black/30"
          >
            <span className="grid h-12 w-12 place-items-center rounded-full bg-white/90 text-primary">
              <Play className="h-5 w-5 fill-current" />
            </span>
          </button>
        )}
      </div>
    );
  }
  if (m.file_type === "audio") {
    return (
      <audio
        src={m.file_url}
        controls
        className="w-full max-w-[18rem]"
        style={{ height: 38 }}
      />
    );
  }
  // generic file — keep download link (only images had the unwanted new-tab)
  return (
    <a
      href={m.file_url}
      download={m.file_name || undefined}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "flex max-w-[18rem] items-center gap-3 rounded-2xl p-3 transition-colors",
        mine ? "bg-white/15 hover:bg-white/25" : "bg-secondary/60 hover:bg-secondary"
      )}
    >
      <span
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
          mine ? "bg-white/20" : "bg-primary/15 text-primary"
        )}
      >
        <FileText className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {m.file_name || "file"}
        </span>
        <span className="block text-xs opacity-70">Tap to download</span>
      </span>
      <Download className="h-4 w-4 opacity-70" />
    </a>
  );
}

function ReplyQuote({
  original,
  mine,
  onJump,
}: {
  original: ChatMessage | undefined;
  mine: boolean;
  onJump?: () => void;
}) {
  if (!original) return null;
  const preview =
    original.sticker ||
    (original.file_url
      ? original.file_type === "image"
        ? "📷 Photo"
        : original.file_type === "video"
        ? "🎥 Video"
        : original.file_type === "audio"
        ? "🎵 Audio"
        : "📎 File"
      : original.content) || "Message";
  return (
    <button
      type="button"
      onClick={onJump}
      className={cn(
        "mb-1.5 flex w-full items-center gap-1.5 rounded-xl border-l-2 px-2.5 py-1 text-left text-[12px] transition-opacity hover:opacity-80",
        mine ? "border-white/70 bg-white/15" : "border-primary bg-primary/10"
      )}
    >
      <ReplyIcon className="h-3 w-3 shrink-0 opacity-70" />
      <span className="font-medium opacity-80">
        {IDENTITIES[original.sender_id].name}
      </span>
      <span className="truncate opacity-70">{preview}</span>
    </button>
  );
}

export function MessageBubble({
  m,
  mine,
  replyOriginal,
  onReply,
  onPin,
  onDelete,
  onJumpTo,
}: {
  m: ChatMessage;
  mine: boolean;
  replyOriginal?: ChatMessage;
  onReply: () => void;
  onPin: () => void;
  onDelete: () => void;
  onJumpTo?: (id: string) => void;
}) {
  const emojiOnly = !m.file_url && !m.sticker && isEmojiOnly(m.content);
  const isSticker = !!m.sticker;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
      className={cn(
        "group flex w-full items-end gap-1.5",
        mine ? "justify-end" : "justify-start"
      )}
    >
      {/* actions menu (shows on hover / tap) */}
      <div
        className={cn(
          "self-center",
          mine ? "order-first" : "order-last"
        )}
      >
        <MessageActions
          message={m}
          mine={mine}
          onReply={onReply}
          onPin={onPin}
          onDelete={onDelete}
        />
      </div>

      <div
        className={cn(
          "flex max-w-[72%] flex-col gap-1 sm:max-w-[65%]",
          mine ? "items-end" : "items-start"
        )}
      >
        <div
          className={cn(
            "relative px-3.5 py-2.5 text-[15px] leading-relaxed",
            emojiOnly
              ? "bg-transparent px-1 py-0"
              : isSticker
              ? "bg-transparent px-1 py-0"
              : mine
              ? "bubble-sent rounded-3xl rounded-br-md"
              : "bubble-received rounded-3xl rounded-bl-md"
          )}
        >
          {!emojiOnly && !isSticker && m.reply_to && (
            <ReplyQuote
              original={replyOriginal}
              mine={mine}
              onJump={m.reply_to ? () => onJumpTo?.(m.reply_to!) : undefined}
            />
          )}
          {m.sticker ? (
            <span className="emoji-big block">{m.sticker}</span>
          ) : emojiOnly ? (
            <span className="emoji-big block whitespace-pre-wrap break-words">
              {m.content}
            </span>
          ) : (
            <>
              {m.file_url && (
                <div className={cn("mb-1.5", mine ? "-mx-1 -mt-1" : "-mx-1 -mt-1")}>
                  <FileBlock m={m} mine={mine} />
                </div>
              )}
              {m.content && (
                <p className="whitespace-pre-wrap break-words">{m.content}</p>
              )}
            </>
          )}
          {m.pinned && (
            <span className="absolute -top-2 -right-1 text-sm">📌</span>
          )}
        </div>

        {/* meta row */}
        <div
          className={cn(
            "flex items-center gap-1 px-1.5 text-[10.5px] text-muted-foreground",
            mine ? "flex-row-reverse" : "flex-row"
          )}
        >
          <span>{formatTime(m.created_at)}</span>
        </div>
      </div>
    </motion.div>
  );
}
