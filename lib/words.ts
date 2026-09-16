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

/** Postgres raises 23505 for any unique-constraint violation. */
function isUniqueViolation(error: unknown) {
  return (error as { code?: string } | null)?.code === "23505";
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

export async function createRoom(name: string): Promise<Room> {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 40) || "Our Stash";
  const sql = db();

  // Collisions are vanishingly unlikely, but a retry is cheaper than an outage.
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = makeCode();
    try {
      const [row] = await sql<Array<{ created_at: number }>>`
        INSERT INTO rooms (code, name) VALUES (${code}, ${clean})
        RETURNING created_at
      `;
      return { code, name: clean, createdAt: row.created_at };
    } catch (error) {
      if (isUniqueViolation(error)) continue;
      throw error;
    }
  }
  throw new Error("Could not allocate a room code");
}

export async function getRoom(code: string): Promise<Room | null> {
  const [row] = await db()<Array<{ code: string; name: string; created_at: number }>>`
    SELECT code, name, created_at FROM rooms WHERE code = ${code.toUpperCase()}
  `;
  return row
    ? { code: row.code, name: row.name, createdAt: row.created_at }
    : null;
}

export async function renameRoom(
  code: string,
  name: string,
): Promise<Room | null> {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 40);
  if (!clean) return getRoom(code);
  await db()`UPDATE rooms SET name = ${clean} WHERE code = ${code.toUpperCase()}`;
  return getRoom(code);
}

export async function listWords(code: string): Promise<Word[]> {
  const rows = await db()<
    Array<{
      id: number;
      text: string;
      added_by: string;
      created_at: number;
      user_id: string | null;
      display_name: string | null;
      avatar_url: string | null;
    }>
  >`
    SELECT w.id, w.text, w.added_by, w.created_at, w.user_id,
           u.display_name, u.avatar_url
      FROM words w
      LEFT JOIN users u ON u.id = w.user_id
     WHERE w.room_code = ${code.toUpperCase()}
     ORDER BY w.id DESC
  `;

  // An account's current display name wins over whatever nickname was typed
  // at the time.
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
export async function addWords(
  code: string,
  input: string,
  addedBy: string,
  userId: string | null = null,
): Promise<number> {
  const room = code.toUpperCase();
  const author = addedBy.replace(/\s+/g, " ").trim().slice(0, 24) || "someone";
  const words = parseWords(input);
  if (words.length === 0) return 0;

  const sql = db();
  const rows = words.map((text) => ({
    room_code: room,
    text,
    added_by: author,
    user_id: userId,
  }));

  // One statement rather than one per word: over a Frankfurt round trip, a
  // pasted list of fifty would otherwise cost fifty times ~150 ms.
  // parseWords has already removed case-insensitive duplicates within the
  // batch, so the only conflicts left are against words already stored.
  const result = await sql`
    INSERT INTO words ${sql(rows, "room_code", "text", "added_by", "user_id")}
    ON CONFLICT DO NOTHING
  `;
  return result.count;
}

export async function deleteWord(code: string, id: number): Promise<boolean> {
  const result = await db()`
    DELETE FROM words WHERE room_code = ${code.toUpperCase()} AND id = ${id}
  `;
  return result.count > 0;
}

export async function clearWords(code: string): Promise<number> {
  const result = await db()`
    DELETE FROM words WHERE room_code = ${code.toUpperCase()}
  `;
  return result.count;
}
