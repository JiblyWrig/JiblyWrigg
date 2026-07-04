"use client";

import type { UserId } from "./types";
import { isSupabaseConfigured } from "./supabase";

/**
 * Each device gets a persistent client id. With Supabase configured we keep
 * it in localStorage (persistent per physical device, so "my device = always
 * me"). In local preview mode we keep it in sessionStorage so two browser
 * tabs act as the two different people.
 */
const KEY = "lilac:clientId";

export function getClientId(): string {
  if (typeof window === "undefined") return "";
  const store = isSupabaseConfigured ? localStorage : sessionStorage;
  let id = store.getItem(KEY);
  if (!id) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    store.setItem(KEY, id);
  }
  return id;
}
