import crypto from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";
import type { OAuthProfile, Provider } from "./oauth";
import type { PublicUser } from "./shared";
import {
  currentStep,
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCode,
  verifyTotp,
} from "./totp";

export const SESSION_COOKIE = "stash_session";
export const OAUTH_STATE_COOKIE = "stash_oauth_state";
export const OAUTH_VERIFIER_COOKIE = "stash_oauth_verifier";
export const OAUTH_RETURN_COOKIE = "stash_oauth_return";

const SESSION_DAYS = 30;

export type AccountUser = PublicUser & { email: string | null; createdAt: number };

type UserRow = {
  id: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  is_admin: number;
  created_at: number;
};

function toUser(row: UserRow): AccountUser {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    avatarUrl: row.avatar_url,
    isAdmin: row.is_admin === 1,
    createdAt: row.created_at,
  };
}

/**
 * Cookies are only marked Secure when the app knows it is served over HTTPS.
 * Getting this wrong in either direction breaks sign-in, so it keys off the
 * APP_URL you configure rather than guessing from NODE_ENV.
 */
function secureCookies() {
  return (process.env.APP_URL ?? "").trim().startsWith("https://");
}

export function sessionCookieOptions(maxAge: number = SESSION_DAYS * 86400) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: secureCookies(),
    path: "/",
    maxAge,
  };
}

export function transientCookieOptions() {
  // Ten minutes is plenty to bounce through a provider and come back.
  return { ...sessionCookieOptions(600), maxAge: 600 };
}

export function getUser(id: string): AccountUser | null {
  const row = db()
    .prepare(
      "SELECT id, display_name, email, avatar_url, is_admin, created_at FROM users WHERE id = ?",
    )
    .get(id) as UserRow | undefined;
  return row ? toUser(row) : null;
}

/**
 * Finds the account behind an OAuth profile, linking a second provider to an
 * existing account when both sides report the same *verified* email. Linking
 * on an unverified address would let anyone claim someone else's account.
 */
export function linkOrCreateUser(
  provider: Provider,
  profile: OAuthProfile,
): AccountUser {
  const database = db();
  const now = Date.now();

  const existingLink = database
    .prepare(
      "SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_id = ?",
    )
    .get(provider.id, profile.providerId) as { user_id: string } | undefined;

  if (existingLink) {
    // Keep the name and avatar fresh on every sign-in.
    database
      .prepare("UPDATE users SET display_name = ?, avatar_url = ? WHERE id = ?")
      .run(profile.displayName, profile.avatarUrl, existingLink.user_id);
    return getUser(existingLink.user_id)!;
  }

  let userId: string | null = null;

  if (profile.email) {
    const byEmail = database
      .prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE")
      .get(profile.email) as { id: string } | undefined;
    if (byEmail) userId = byEmail.id;
  }

  if (!userId) {
    userId = crypto.randomUUID();
    // The very first account to sign in owns the instance.
    const { count } = database.prepare("SELECT COUNT(*) AS count FROM users").get() as {
      count: number;
    };
    database
      .prepare(
        `INSERT INTO users (id, display_name, email, avatar_url, is_admin, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        userId,
        profile.displayName,
        profile.email,
        profile.avatarUrl,
        count === 0 ? 1 : 0,
        now,
      );
  }

  database
    .prepare(
      `INSERT INTO oauth_accounts (provider, provider_id, user_id, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(provider.id, profile.providerId, userId, now);

  return getUser(userId)!;
}

export function listLinkedProviders(userId: string): string[] {
  const rows = db()
    .prepare("SELECT provider FROM oauth_accounts WHERE user_id = ? ORDER BY created_at")
    .all(userId) as Array<{ provider: string }>;
  return rows.map((row) => row.provider);
}

export function updateDisplayName(userId: string, name: string) {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 32);
  if (!clean) return;
  db().prepare("UPDATE users SET display_name = ? WHERE id = ?").run(clean, userId);
}

/* ---------------------------------------------------------------- sessions */

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Returns the raw token for the cookie; only its hash is stored, so a leaked
 * database file cannot be replayed as a live session.
 */
export function createSession(userId: string, needsTotp: boolean): string {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO sessions (id, user_id, needs_totp, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      hashToken(token),
      userId,
      needsTotp ? 1 : 0,
      now,
      now + SESSION_DAYS * 86400 * 1000,
    );
  return token;
}

type ResolvedSession = { id: string; user: AccountUser; needsTotp: boolean };

function resolveToken(token: string): ResolvedSession | null {
  const id = hashToken(token);
  const row = db()
    .prepare("SELECT user_id, needs_totp, expires_at FROM sessions WHERE id = ?")
    .get(id) as
    | { user_id: string; needs_totp: number; expires_at: number }
    | undefined;

  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db().prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return null;
  }

  const user = getUser(row.user_id);
  if (!user) return null;
  return { id, user, needsTotp: row.needs_totp === 1 };
}

async function readSession(): Promise<ResolvedSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? resolveToken(token) : null;
}

/** The signed-in account, or null — a session still owing a TOTP code is not signed in. */
export async function currentUser(): Promise<AccountUser | null> {
  const session = await readSession();
  return session && !session.needsTotp ? session.user : null;
}

/** The half-authenticated account waiting at the two-factor prompt. */
export async function pendingTwoFactorUser(): Promise<AccountUser | null> {
  const session = await readSession();
  return session && session.needsTotp ? session.user : null;
}

export async function completeTwoFactor() {
  const session = await readSession();
  if (!session) return;
  db().prepare("UPDATE sessions SET needs_totp = 0 WHERE id = ?").run(session.id);
}

export async function signOut() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    db().prepare("DELETE FROM sessions WHERE id = ?").run(hashToken(token));
  }
  store.delete(SESSION_COOKIE);
}

/** Used after enabling 2FA, so other devices have to sign in again. */
export async function revokeOtherSessions() {
  const session = await readSession();
  if (!session) return;
  db()
    .prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?")
    .run(session.user.id, session.id);
}

/* ------------------------------------------------------------ two-factor */

type TotpRow = {
  secret: string;
  confirmed_at: number | null;
  last_step: number | null;
};

function totpRow(userId: string): TotpRow | undefined {
  return db()
    .prepare(
      "SELECT secret, confirmed_at, last_step FROM totp_credentials WHERE user_id = ?",
    )
    .get(userId) as TotpRow | undefined;
}

export function twoFactorEnabled(userId: string): boolean {
  return totpRow(userId)?.confirmed_at != null;
}

/**
 * Hands back the secret to put in the QR code, creating one on first use.
 * An existing secret is reused so that reloading the setup page does not
 * invalidate a code the user has already scanned; starting over means turning
 * two-factor off first, which deletes the row.
 */
export function beginTotpEnrollment(userId: string): string {
  const row = totpRow(userId);
  if (row) return row.secret;

  const secret = generateSecret();
  db()
    .prepare(
      `INSERT INTO totp_credentials (user_id, secret, confirmed_at, last_step, created_at)
       VALUES (?, ?, NULL, NULL, ?)
       ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret, created_at = excluded.created_at`,
    )
    .run(userId, secret, Date.now());
  return secret;
}

/**
 * Accepts a code for an unconfirmed secret, turns 2FA on, and returns the
 * one-time recovery codes. They are shown once and stored only as hashes.
 */
export function confirmTotpEnrollment(
  userId: string,
  code: string,
): string[] | null {
  const row = totpRow(userId);
  if (!row || row.confirmed_at != null) return null;

  const step = verifyTotp(row.secret, code);
  if (step === null) return null;

  const database = db();
  database
    .prepare(
      "UPDATE totp_credentials SET confirmed_at = ?, last_step = ? WHERE user_id = ?",
    )
    .run(Date.now(), step, userId);

  const codes = generateRecoveryCodes();
  database.prepare("DELETE FROM recovery_codes WHERE user_id = ?").run(userId);
  const insert = database.prepare(
    "INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)",
  );
  for (const recovery of codes) insert.run(userId, hashRecoveryCode(recovery));

  return codes;
}

/**
 * Verifies a code at the sign-in prompt. Each step is remembered so the same
 * six digits cannot be replayed inside their 30-second window.
 */
export function consumeTotp(userId: string, code: string): boolean {
  const row = totpRow(userId);
  if (!row || row.confirmed_at == null) return false;

  const step = verifyTotp(row.secret, code);
  if (step === null) return false;
  if (row.last_step != null && step <= row.last_step) return false;

  db()
    .prepare("UPDATE totp_credentials SET last_step = ? WHERE user_id = ?")
    .run(step, userId);
  return true;
}

export function consumeRecoveryCode(userId: string, code: string): boolean {
  const hash = hashRecoveryCode(code);
  const result = db()
    .prepare(
      "UPDATE recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL",
    )
    .run(Date.now(), userId, hash);
  return result.changes > 0;
}

export function countRecoveryCodes(userId: string): number {
  const { count } = db()
    .prepare(
      "SELECT COUNT(*) AS count FROM recovery_codes WHERE user_id = ? AND used_at IS NULL",
    )
    .get(userId) as { count: number };
  return count;
}

export function disableTwoFactor(userId: string) {
  const database = db();
  database.prepare("DELETE FROM totp_credentials WHERE user_id = ?").run(userId);
  database.prepare("DELETE FROM recovery_codes WHERE user_id = ?").run(userId);
}

/** Exposed for the sign-in callback, which must gate the session before issuing it. */
export function requiresTwoFactor(userId: string): boolean {
  return twoFactorEnabled(userId);
}

export { currentStep };
