"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, X, RefreshCw, Check, CameraOff } from "lucide-react";
import { cn } from "@/lib/utils";

export function SelfieCapture({
  open,
  onClose,
  onCapture,
}: {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const [shot, setShot] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [facing, setFacing] = React.useState<"user" | "environment">("user");

  const stop = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = React.useCallback(async (mode: "user" | "environment") => {
    setError(null);
    stop();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch {
      setError(
        "Couldn't access the camera. Allow camera permission and try again."
      );
    }
  }, [stop]);

  React.useEffect(() => {
    if (open) {
      setShot(null);
      start(facing);
    } else {
      stop();
    }
    return stop;
  }, [open, facing, start, stop]);

  const takeShot = () => {
    const video = videoRef.current;
    if (!video) return;
    const w = video.videoWidth || 720;
    const h = video.videoHeight || 720;
    const canvas = document.createElement("canvas");
    const size = Math.min(w, h);
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // center crop + mirror if front cam
    const sx = (w - size) / 2;
    const sy = (h - size) / 2;
    if (facing === "user") {
      ctx.translate(size, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
    setShot(canvas.toDataURL("image/jpeg", 0.9));
  };

  const send = () => {
    if (!shot) return;
    canvasUrlToFile(shot, `selfie-${Date.now()}.jpg`).then((file) => {
      onCapture(file);
      handleClose();
    });
  };

  const handleClose = () => {
    stop();
    setShot(null);
    onClose();
  };

  const flip = () => setFacing((f) => (f === "user" ? "environment" : "user"));

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ scale: 0.9, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.9, y: 20, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md overflow-hidden rounded-[2rem] border border-white/10 bg-card p-3 shadow-2xl"
          >
            <div className="relative aspect-square w-full overflow-hidden rounded-[1.5rem] bg-black">
              {!shot ? (
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className={cn(
                    "h-full w-full object-cover",
                    facing === "user" && "-scale-x-100"
                  )}
                />
              ) : (
                <img
                  src={shot}
                  alt="selfie"
                  className="h-full w-full object-cover"
                />
              )}

              {/* shutter overlay flash */}
              <motion.div
                key={shot ? "shot" : "live"}
                initial={shot ? { opacity: 0.8 } : false}
                animate={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="pointer-events-none absolute inset-0 bg-white"
              />

              {error && (
                <div className="absolute inset-0 grid place-items-center p-6 text-center">
                  <div className="flex flex-col items-center gap-3 text-white/80">
                    <CameraOff className="h-10 w-10" />
                    <p className="text-sm">{error}</p>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={handleClose}
                className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/40 text-white backdrop-blur transition hover:bg-black/60"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* controls */}
            <div className="mt-3 flex items-center justify-center gap-6">
              {!shot ? (
                <>
                  <button
                    type="button"
                    onClick={flip}
                    className="grid h-12 w-12 place-items-center rounded-full bg-secondary/80 text-foreground transition hover:bg-secondary"
                    title="Flip camera"
                  >
                    <RefreshCw className="h-5 w-5" />
                  </button>
                  <motion.button
                    type="button"
                    onClick={takeShot}
                    whileTap={{ scale: 0.88 }}
                    className="grid h-18 w-18 place-items-center rounded-full border-4 border-primary bg-white p-1 shadow-lg"
                    style={{ height: 72, width: 72 }}
                  >
                    <span className="grid h-full w-full place-items-center rounded-full bg-primary/15">
                      <Camera className="h-7 w-7 text-primary" />
                    </span>
                  </motion.button>
                  <div className="h-12 w-12" />
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setShot(null)}
                    className="grid h-12 w-12 place-items-center rounded-full bg-secondary/80 text-foreground transition hover:bg-secondary"
                    title="Retake"
                  >
                    <RefreshCw className="h-5 w-5" />
                  </button>
                  <motion.button
                    type="button"
                    onClick={send}
                    whileTap={{ scale: 0.88 }}
                    className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-pink-500 text-white shadow-lg"
                    title="Send"
                  >
                    <Check className="h-7 w-7" />
                  </motion.button>
                  <div className="h-12 w-12" />
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function canvasUrlToFile(dataUrl: string, name: string): Promise<File> {
  return fetch(dataUrl)
    .then((r) => r.blob())
    .then((blob) => new File([blob], name, { type: "image/jpeg" }));
}
