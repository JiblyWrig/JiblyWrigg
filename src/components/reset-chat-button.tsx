"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Trash2, AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export function ResetChatButton({
  onReset,
}: {
  onReset: () => Promise<void> | void;
}) {
  const [open, setOpen] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const CONFIRM_WORD = "reset";
  const canConfirm = confirmText.trim().toLowerCase() === CONFIRM_WORD;

  const doReset = async () => {
    if (!canConfirm) return;
    setBusy(true);
    try {
      await onReset();
    } finally {
      setBusy(false);
      setOpen(false);
      setConfirmText("");
    }
  };

  return (
    <>
      <motion.button
        type="button"
        whileTap={{ scale: 0.85 }}
        whileHover={{ scale: 1.08 }}
        onClick={() => setOpen(true)}
        aria-label="Reset chat"
        title="Reset chat"
        className="grid h-10 w-10 place-items-center rounded-full bg-secondary/70 text-muted-foreground backdrop-blur transition-colors hover:bg-destructive/15 hover:text-destructive"
      >
        <Trash2 className="h-[17px] w-[17px]" />
      </motion.button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="max-w-sm rounded-[1.75rem] border-border/60">
          <AlertDialogHeader>
            <motion.div
              initial={{ scale: 0, rotate: -15 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 16 }}
              className="mx-auto mb-1 grid h-14 w-14 place-items-center rounded-full bg-destructive/15 text-destructive"
            >
              <AlertTriangle className="h-7 w-7" />
            </motion.div>
            <AlertDialogTitle className="text-center text-xl">
              Reset our chat?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center">
              This permanently deletes <strong>every message, photo and
              file</strong> for both of you. There's no undo.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="mt-2">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Type{" "}
              <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-foreground">
                {CONFIRM_WORD}
              </span>{" "}
              to confirm
            </label>
            <input
              autoFocus
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canConfirm && doReset()}
              placeholder={CONFIRM_WORD}
              className="w-full rounded-2xl border border-border bg-background/70 px-4 py-2.5 text-sm outline-none transition-all focus:border-destructive focus:ring-2 focus:ring-destructive/25"
            />
          </div>

          <AlertDialogFooter className="mt-4 sm:flex-col sm:space-x-0 sm:space-y-2">
            <AlertDialogCancel className="mt-0 rounded-2xl">
              Keep our memories
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                doReset();
              }}
              disabled={!canConfirm || busy}
              className={cn(
                "rounded-2xl bg-destructive text-destructive-foreground hover:bg-destructive/90",
                !canConfirm && "cursor-not-allowed opacity-50"
              )}
            >
              {busy ? "Resetting…" : "Yes, reset everything"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
