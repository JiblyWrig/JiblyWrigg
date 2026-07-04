"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { ResetChatButton } from "./reset-chat-button";

export function ChatHeader({
  partnerName,
  onReset,
}: {
  partnerName: string;
  onReset: () => Promise<void> | void;
}) {
  return (
    <header className="glass-panel relative z-20 border-b border-border/50">
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-3 py-2.5 sm:px-5">
        {/* name */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="truncate text-[15px] font-semibold leading-tight">
              {partnerName}
            </h2>
            <Heart />
          </div>
        </div>

        {/* controls */}
        <div className="flex items-center gap-1.5">
          <ResetChatButton onReset={onReset} />
        </div>
      </div>
    </header>
  );
}

function Heart() {
  return (
    <motion.span
      animate={{ scale: [1, 1.25, 1] }}
      transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      className="text-fuchsia-400"
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
        <path d="M12 21s-7.5-4.6-10-9.2C.4 8.5 2 5 5.4 5c2 0 3.4 1.1 4.1 2.4l.5.9.5-.9C11.2 6.1 12.6 5 14.6 5 18 5 19.6 8.5 22 11.8 19.5 16.4 12 21 12 21z" />
      </svg>
    </motion.span>
  );
}
