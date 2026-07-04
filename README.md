# 💜 Lilac — a private chat for two

A bubbly, animated, lilac-themed private chat for exactly two people (you & your
partner). Messaging, file sharing, selfies, custom emojis, real-time online
indicator, read receipts (✓ / ✓✓ / ✓✓ blue), a night mode, and a verified
"reset chat" — all wrapped in a smooth, polished UI.

Built with **Next.js 16 + TypeScript + Tailwind CSS 4 + Framer Motion +
Supabase** (realtime + storage). It also runs in a **local preview mode** when
Supabase isn't configured yet, so two browser tabs act as the two people.

---

## 1. Add this project to a GitHub repository

From inside this project folder:

```bash
# initialize git (if not already)
git init
git add .
git commit -m "💜 Lilac chat — initial commit"

# create an empty repo on GitHub first (no README, no .gitignore),
# then connect & push:
git remote add origin https://github.com/<your-username>/<your-repo>.git
git branch -M main
git push -u origin main
```

> If you downloaded this as a zip, just drop the files into your new repo folder
> and run the commands above.

---

## 2. Connect Supabase (so it works for real, across two devices)

Supabase gives you a real-time database + file storage, free for a tiny 2-person
app. Do this once:

### Step 1 — Create a Supabase project
1. Go to **https://supabase.com** → sign in → **New project**.
2. Pick a name (e.g. `lilac-chat`), set a strong DB password, choose a region
   close to you, and **Create**. Wait ~2 min for it to provision.

### Step 2 — Create the database & storage
1. In your project, open **SQL Editor** → **New query**.
2. Open the file `supabase/schema.sql` from this repo, copy its **entire**
   contents, paste into the editor, and **Run**.
   - This creates the `messages` table, enables Row-Level Security, turns on
     **realtime**, and creates a public `chat-files` storage bucket for
     photos/selfies/files.

### Step 3 — Get your API keys
1. Go to **Project Settings** (⚙ bottom-left) → **API**.
2. Copy two values:
   - **Project URL** → e.g. `https://abcdxyz.supabase.co`
   - **anon public key** → the long `eyJhbGciOi...` string

### Step 4 — Put the keys in your repo
1. In the project root, copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
2. Open `.env.local` and fill in your two values:
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://abcdxyz.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...your-anon-key...
   ```
3. **Important:** `.env.local` is git-ignored by default (never commit secrets).
   For a deployed version (Vercel/Netlify), add the same two variables in the
   host's **Environment Variables** settings instead.
4. Restart your dev server so it picks up the keys:
   ```bash
   bun run dev
   ```
   The little "Preview mode" pill at the top will disappear once Supabase is
   detected — that's how you know it's live.

### Step 5 — Use it 🎉
- You open the site → pick **You**.
- Your partner opens the site (on their phone/laptop) → picks **Love**.
- That's it. Messages, selfies, files, online status & read receipts now sync
  for real between your two devices.

> The identity you pick is stored in that browser's `localStorage`. To swap who
> you are, tap the **people icon** in the header → pick the other one.

---

## 3. Run locally (development)

```bash
bun install        # install deps
bun run dev        # start on http://localhost:3000
bun run lint       # check code quality
```

Without Supabase keys it runs in **preview mode**: open the site in **two
browser tabs**, pick a different person in each, and you can chat with yourself
in real time (great for testing).

---

## Features

- 💬 **Real-time messaging** — instant via Supabase Realtime (or BroadcastChannel
  in preview mode).
- 📷 **Selfie capture** — in-app camera with front/back flip, mirror preview,
  send as photo.
- 📎 **File sharing** — images, video, audio, documents (stored in Supabase
  Storage / data-URLs in preview).
- 😊 **Custom emoji picker** — 6 curated categories + big "stickers"; emoji-only
  messages render extra-large.
- 🟢 **Real-time online indicator** — pulsing green dot via Supabase Presence.
- ✓✓ **Read receipts** — single ✓ (sent), double ✓✓ (delivered), blue ✓✓ (read).
- ⌨️ **Live typing indicator**.
- 🌙 **Night mode** — deep, dark, night-friendly purples; smooth toggle.
- 🗑️ **Reset chat** — small icon, opens a dialog where you must type `reset` to
  confirm (wipes everything for both people).
- ✨ **Polished animations** — aurora background, floating hearts, springy
  bubbles, animated ticks, theme transitions.

---

## Project structure

```
src/
  app/
    layout.tsx          # theme provider + metadata
    page.tsx            # identity gate + chat screen
    globals.css         # lilac + night theme, animations
  components/
    chat-header.tsx     # avatar, online status, controls
    message-list.tsx    # scrollable list, date separators, typing bubble
    message-bubble.tsx  # bubble, file render, ticks
    message-input.tsx   # text + emoji + attach + selfie + send
    emoji-picker.tsx    # categorized emoji + stickers
    selfie-capture.tsx  # camera modal
    reset-chat-button.tsx
    read-ticks.tsx
    identity-select.tsx
    theme-toggle.tsx
    theme-provider.tsx
  lib/
    chat-store.ts       # Supabase + local backends, zustand store
    supabase.ts         # client + config detection
    types.ts            # identities & message types
    emojis.ts           # emoji data
supabase/
  schema.sql            # run this in Supabase SQL editor
.env.example            # copy to .env.local
```

---

Made with 💜 for two.
