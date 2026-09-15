"use client";

import { useSyncExternalStore } from "react";
import type { Room } from "./shared";

const NICKNAME_KEY = "stash:nickname";
const ROOMS_KEY = "stash:rooms";
const MAX_REMEMBERED = 8;

export type RecentRoom = { code: string; name: string };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows and blocked site data are fine to ignore here.
  }
}

/**
 * localStorage is an external store, so components read it through
 * useSyncExternalStore: the server snapshot keeps hydration honest, and the
 * cached client snapshots stay referentially stable between writes.
 */
const listeners = new Set<() => void>();
let nicknameCache: string | null = null;
let roomsCache: RecentRoom[] | null = null;

function emit() {
  for (const listener of listeners) listener();
}

function handleStorage() {
  nicknameCache = null;
  roomsCache = null;
  emit();
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener("storage", handleStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("storage", handleStorage);
    }
  };
}

function nicknameSnapshot(): string {
  nicknameCache ??= read<string>(NICKNAME_KEY, "");
  return nicknameCache;
}

export function useNickname(): string {
  return useSyncExternalStore(subscribe, nicknameSnapshot, () => "");
}

export function saveNickname(name: string) {
  nicknameCache = name.slice(0, 24);
  write(NICKNAME_KEY, nicknameCache);
  emit();
}

const NO_ROOMS: RecentRoom[] = [];

function roomsSnapshot(): RecentRoom[] {
  if (roomsCache === null) {
    const stored = read<RecentRoom[]>(ROOMS_KEY, NO_ROOMS);
    roomsCache = Array.isArray(stored)
      ? stored.filter((room) => room?.code && room?.name)
      : NO_ROOMS;
  }
  return roomsCache;
}

/** There are no accounts, so the browser remembers which stashes you visited. */
export function useRecentRooms(): RecentRoom[] {
  return useSyncExternalStore(subscribe, roomsSnapshot, () => NO_ROOMS);
}

export function rememberRoom(room: Pick<Room, "code" | "name">) {
  const others = roomsSnapshot().filter((entry) => entry.code !== room.code);
  roomsCache = [{ code: room.code, name: room.name }, ...others].slice(
    0,
    MAX_REMEMBERED,
  );
  write(ROOMS_KEY, roomsCache);
  emit();
}

/**
 * navigator.clipboard is unavailable on plain http, which is exactly how a
 * self-hosted box on the LAN gets reached, so keep the legacy path around.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea trick.
  }
  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.top = "-1000px";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(field);
    return copied;
  } catch {
    return false;
  }
}
