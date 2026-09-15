import { db } from "./db";
import { MAX_WORD_LENGTH, type Room, type Word } from "./shared";

/** Ambiguous characters (0/O, 1/I/L) are left out so codes survive being read aloud. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function makeCode(length = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join(
    "",
  );
}

/**
 * Commas and newlines are separators rather than content, because the whole
 * point of the list is to come back out as one comma-separated string.
 */
export function parseWords(input: string): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const raw of input.split(/[,\n\r\t;]+/)) {
    const text = raw.replace(/\s+/g, " ").trim().slice(0, MAX_WORD_LENGTH);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(text);
  }
  return words;
}

export function createRoom(name: string): Room {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 40) || "Our Stash";
  const createdAt = Date.now();
  const insert = db().prepare(
    "INSERT INTO rooms (code, name, created_at) VALUES (?, ?, ?)",
  );

  // Collisions are vanishingly unlikely, but a retry is cheaper than an outage.
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = makeCode();
    try {
      insert.run(code, clean, createdAt);
      return { code, name: clean, createdAt };
    } catch {
      continue;
    }
  }
  throw new Error("Could not allocate a room code");
}

export function getRoom(code: string): Room | null {
  const row = db()
    .prepare("SELECT code, name, created_at FROM rooms WHERE code = ?")
    .get(code.toUpperCase()) as
    | { code: string; name: string; created_at: number }
    | undefined;
  return row
    ? { code: row.code, name: row.name, createdAt: row.created_at }
    : null;
}

export function renameRoom(code: string, name: string): Room | null {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 40);
  if (!clean) return getRoom(code);
  db()
    .prepare("UPDATE rooms SET name = ? WHERE code = ?")
    .run(clean, code.toUpperCase());
  return getRoom(code);
}

export function listWords(code: string): Word[] {
  const rows = db()
    .prepare(
      `SELECT w.id, w.text, w.added_by, w.created_at, w.user_id,
              u.display_name, u.avatar_url
         FROM words w
         LEFT JOIN users u ON u.id = w.user_id
        WHERE w.room_code = ?
        ORDER BY w.id DESC`,
    )
    .all(code.toUpperCase()) as Array<{
    id: number;
    text: string;
    added_by: string;
    created_at: number;
    user_id: string | null;
    display_name: string | null;
    avatar_url: string | null;
  }>;

  // Rows arrive with a null prototype; rebuild them as plain objects so they
  // serialize cleanly across the server/client boundary. An account's current
  // display name wins over whatever nickname was typed at the time.
  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    addedBy: row.display_name ?? row.added_by,
    userId: row.user_id,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
  }));
}

/** Returns how many words were new — duplicates are silently skipped. */
export function addWords(
  code: string,
  input: string,
  addedBy: string,
  userId: string | null = null,
): number {
  const room = code.toUpperCase();
  const author = addedBy.replace(/\s+/g, " ").trim().slice(0, 24) || "someone";
  const insert = db().prepare(
    `INSERT OR IGNORE INTO words (room_code, text, added_by, user_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  let added = 0;
  const now = Date.now();
  for (const text of parseWords(input)) {
    const result = insert.run(room, text, author, userId, now);
    if (result.changes > 0) added++;
  }
  return added;
}

export function deleteWord(code: string, id: number): boolean {
  const result = db()
    .prepare("DELETE FROM words WHERE room_code = ? AND id = ?")
    .run(code.toUpperCase(), id);
  return result.changes > 0;
}

export function clearWords(code: string): number {
  return Number(
    db()
      .prepare("DELETE FROM words WHERE room_code = ?")
      .run(code.toUpperCase()).changes,
  );
}
