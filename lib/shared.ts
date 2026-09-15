/** Types and limits shared by the server and the browser. */

export type Room = { code: string; name: string; createdAt: number };

export type Word = {
  id: number;
  text: string;
  /** Account display name when signed in, otherwise the typed nickname. */
  addedBy: string;
  userId: string | null;
  avatarUrl: string | null;
  createdAt: number;
};

export type PublicUser = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
};

/** skribbl.io allows 1-32 characters per custom word... */
export const MAX_WORD_LENGTH = 32;
/** ...refuses a custom list shorter than ten words... */
export const SKRIBBL_MINIMUM = 10;
/** ...and caps the whole comma-separated string at 10000 characters. */
export const MAX_EXPORT_CHARS = 10000;

/** Contributing words counts for something until real games are flowing in. */
export const XP_PER_WORD = 5;

/**
 * Levels are quadratic: level n starts at 100*(n-1)^2 XP, so early levels come
 * quickly and later ones do not.
 */
export function levelFor(xp: number) {
  const total = Math.max(0, Math.floor(xp));
  const level = Math.floor(Math.sqrt(total / 100)) + 1;
  const floor = 100 * (level - 1) ** 2;
  const ceiling = 100 * level ** 2;
  return {
    level,
    xp: total,
    into: total - floor,
    needed: ceiling - floor,
    progress: (total - floor) / (ceiling - floor),
  };
}
