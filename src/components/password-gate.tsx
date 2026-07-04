"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, Heart } from "lucide-react";

const PASSWORD = "17368";
const SS_KEY = "lilac:authed";

export function isAuthed(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(SS_KEY) === "1";
}

export function PasswordGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = React.useState(false);
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState(false);
  const [checking, setChecking] = React.useState(false);

  React.useEffect(() => {
    setAuthed(isAuthed());
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setChecking(true);
    // tiny delay for the button animation
    window.setTimeout(() => {
      if (value === PASSWORD) {
        sessionStorage.setItem(SS_KEY, "1");
        setAuthed(true);
        setValue("");
        setError(false);
      } else {
        setError(true);
      }
      setChecking(false);
    }, 350);
  };

  return (
    <>
      {authed && children}
      <AnimatePresence>
        {!authed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] grid place-items-center p-4"
          >
            {/* subtle darkening so the lock card stays readable */}
            <div className="absolute inset-0 bg-background/70 backdrop-blur-xl" />

            <motion.div
              initial={{ scale: 0.9, y: 24, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.92, y: 12, opacity: 0 }}
              transition={{ type: "spring", stiffness: 240, damping: 22 }}
              className="relative w-full max-w-sm"
            >
              <div className="glass-panel rounded-[2rem] border border-border/60 p-7 shadow-2xl shadow-primary/20">
                <motion.div
                  initial={{ scale: 0, rotate: -15 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{
                    delay: 0.1,
                    type: "spring",
                    stiffness: 260,
                    damping: 14,
                  }}
                  className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-3xl bg-gradient-to-br from-violet-400 via-fuchsia-400 to-pink-400 shadow-lg shadow-fuchsia-300/40"
                >
                  <Lock className="h-7 w-7 text-white" />
                </motion.div>

                <h1 className="text-center text-xl font-bold tracking-tight">
                  Welcome back
                </h1>
                <p className="mt-1.5 text-center text-sm text-muted-foreground">
                  Enter the secret code to open our space.
                </p>

                <form onSubmit={submit} className="mt-6">
                  <motion.input
                    type="password"
                    inputMode="numeric"
                    autoFocus
                    value={value}
                    onChange={(e) => {
                      setValue(e.target.value);
                      setError(false);
                    }}
                    placeholder="• • • • •"
                    className={`w-full rounded-2xl border bg-background/70 px-4 py-3 text-center text-lg tracking-[0.5em] outline-none transition-all placeholder:tracking-normal placeholder:text-muted-foreground/50 ${
                      error
                        ? "border-destructive ring-2 ring-destructive/25"
                        : "border-border focus:border-primary focus:ring-2 focus:ring-primary/30"
                    }`}
                    animate={
                      error
                        ? { x: [0, -8, 8, -6, 6, 0] }
                        : { x: 0 }
                    }
                    transition={{ duration: 0.4 }}
                  />
                  <AnimatePresence>
                    {error && (
                      <motion.p
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-2 text-center text-xs text-destructive"
                      >
                        Not quite — try again 💜
                      </motion.p>
                    )}
                  </AnimatePresence>

                  <motion.button
                    type="submit"
                    disabled={checking || value.length === 0}
                    whileTap={{ scale: 0.97 }}
                    whileHover={{ scale: 1.02 }}
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-fuchsia-400/30 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Heart className="h-4 w-4 fill-white" />
                    {checking ? "Opening…" : "Enter"}
                  </motion.button>
                </form>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
