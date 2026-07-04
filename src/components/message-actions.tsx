"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { MoreVertical, Reply, Pin, PinOff, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

export function MessageActions({
  message,
  mine,
  onReply,
  onPin,
  onDelete,
}: {
  message: ChatMessage;
  mine: boolean;
  onReply: () => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <motion.button
          type="button"
          aria-label="Message options"
          whileTap={{ scale: 0.85 }}
          whileHover={{ scale: 1.1 }}
          className={cn(
            "grid h-7 w-7 shrink-0 place-items-center self-center rounded-full text-muted-foreground transition-all",
            "opacity-0 group-hover:opacity-100 focus:opacity-100",
            "hover:bg-secondary hover:text-foreground",
            "max-sm:opacity-70"
          )}
        >
          <MoreVertical className="h-4 w-4" />
        </motion.button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={mine ? "end" : "start"}
        side="top"
        className="w-40 rounded-2xl"
      >
        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            onReply();
          }}
          className="cursor-pointer rounded-xl"
        >
          <Reply className="mr-2 h-4 w-4" />
          Reply
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            onPin();
          }}
          className="cursor-pointer rounded-xl"
        >
          {message.pinned ? (
            <>
              <PinOff className="mr-2 h-4 w-4" />
              Unpin
            </>
          ) : (
            <>
              <Pin className="mr-2 h-4 w-4" />
              Pin
            </>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            onDelete();
          }}
          className="cursor-pointer rounded-xl text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
