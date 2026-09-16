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
  is_admin: boolean;
  created_at: number;
};

function toUser(row: UserRow): AccountUser {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    avatarUrl: row.avatar_url,
    isAdmin: row.is_admin,
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

export async function getUser(id: string): Promise<AccountUser | null> {
  const [row] = await db()<UserRow[]>`
    SELECT id, display_name, email, avatar_url, is_admin, created_at
      FROM users WHERE id = ${id}
  `;
  return row ? toUser(row) : null;
}

/**
 * Finds the account behind an OAuth profile, linking a second provider to an
 * existing account when both sides report the same *verified* email. Linking
 * on an unverified address would let anyone claim someone else's account.
 */
export async function linkOrCreateUser(
  provider: Provider,
  profile: OAuthProfile,
): Promise<AccountUser> {
  const sql = db();

  const [existingLink] = await sql<Array<{ user_id: string }>>`
    SELECT user_id FROM oauth_accounts
     WHERE provider = ${provider.id} AND provider_id = ${profile.providerId}
  `;

  if (existingLink) {
    // Keep the name and avatar fresh on every sign-in.
    await sql`
      UPDATE users
         SET display_name = ${profile.displayName}, avatar_url = ${profile.avatarUrl}
       WHERE id = ${existingLink.user_id}
    `;
    return (await getUser(existingLink.user_id))!;
  }

  // Finding the account and linking the provider to it has to be atomic, or
  // two simultaneous first sign-ins could both see an empty users table and
  // both claim ownership.
  const userId = await sql.begin(async (tx) => {
    let id: string | null = null;

    if (profile.email) {
      // email is citext, so this matches case-insensitively without COLLATE.
      const [byEmail] = await tx<Array<{ id: string }>>`
        SELECT id FROM users WHERE email = ${profile.email}
      `;
      if (byEmail) id = byEmail.id;
    }

    if (!id) {
      id = crypto.randomUUID();
      // The very first account to sign in owns the instance.
      const [{ count }] = await tx<Array<{ count: number }>>`
        SELECT COUNT(*) AS count FROM users
      `;
      await tx`
        INSERT INTO users (id, display_name, email, avatar_url, is_admin)
        VALUES (${id}, ${profile.displayName}, ${profile.email},
                ${profile.avatarUrl}, ${count === 0})
      `;
    }

    await tx`
      INSERT INTO oauth_accounts (provider, provider_id, user_id)
      VALUES (${provider.id}, ${profile.providerId}, ${id})
    `;
    return id;
  });

  return (await getUser(userId as string))!;
}

export async function listLinkedProviders(userId: string): Promise<string[]> {
  const rows = await db()<Array<{ provider: string }>>`
    SELECT provider FROM oauth_accounts WHERE user_id = ${userId} ORDER BY created_at
  `;
  return rows.map((row) => row.provider);
}

export async function updateDisplayName(userId: string, name: string) {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 32);
  if (!clean) return;
  await db()`UPDATE users SET display_name = ${clean} WHERE id = ${userId}`;
}

/* ---------------------------------------------------------------- sessions */

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Returns the raw token for the cookie; only its hash is stored, so a leaked
 * database dump cannot be replayed as a live session.
 */
export async function createSession(
  userId: string,
  needsTotp: boolean,
): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  await db()`
    INSERT INTO sessions (id, user_id, needs_totp, expires_at)
    VALUES (${hashToken(token)}, ${userId}, ${needsTotp},
            now() + ${SESSION_DAYS} * interval '1 day')
  `;
  return token;
}

type ResolvedSession = { id: string; user: AccountUser; needsTotp: boolean };

async function resolveToken(token: string): Promise<ResolvedSession | null> {
  const sql = db();
  const id = hashToken(token);
  const [row] = await sql<
    Array<{ user_id: string; needs_totp: boolean; expires_at: number }>
  >`
    SELECT user_id, needs_totp, expires_at FROM sessions WHERE id = ${id}
  `;

  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await sql`DELETE FROM sessions WHERE id = ${id}`;
    return null;
  }

  const user = await getUser(row.user_id);
  if (!user) return null;
  return { id, user, needsTotp: row.needs_totp };
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
  await db()`UPDATE sessions SET needs_totp = false WHERE id = ${session.id}`;
}

export async function signOut() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db()`DELETE FROM sessions WHERE id = ${hashToken(token)}`;
  }
  store.delete(SESSION_COOKIE);
}

/** Used after enabling 2FA, so other devices have to sign in again. */
export async function revokeOtherSessions() {
  const session = await readSession();
  if (!session) return;
  await db()`
    DELETE FROM sessions WHERE user_id = ${session.user.id} AND id != ${session.id}
  `;
}

/* ------------------------------------------------------------ two-factor */

type TotpRow = {
  secret: string;
  confirmed_at: number | null;
  last_step: number | null;
};

async function totpRow(userId: string): Promise<TotpRow | undefined> {
  const [row] = await db()<TotpRow[]>`
    SELECT secret, confirmed_at, last_step
      FROM totp_credentials WHERE user_id = ${userId}
  `;
  return row;
}

export async function twoFactorEnabled(userId: string): Promise<boolean> {
  return (await totpRow(userId))?.confirmed_at != null;
}

/**
 * Hands back the secret to put in the QR code, creating one on first use.
 * An existing secret is reused so that reloading the setup page does not
 * invalidate a code the user has already scanned; starting over means turning
 * two-factor off first, which deletes the row.
 */
export async function beginTotpEnrollment(userId: string): Promise<string> {
  const row = await totpRow(userId);
  if (row) return row.secret;

  const secret = generateSecret();
  await db()`
    INSERT INTO totp_credentials (user_id, secret, confirmed_at, last_step)
    VALUES (${userId}, ${secret}, NULL, NULL)
    ON CONFLICT (user_id) DO UPDATE
      SET secret = excluded.secret, created_at = now()
  `;
  return secret;
}

/**
 * Accepts a code for an unconfirmed secret, turns 2FA on, and returns the
 * one-time recovery codes. They are shown once and stored only as hashes.
 */
export async function confirmTotpEnrollment(
  userId: string,
  code: string,
): Promise<string[] | null> {
  const row = await totpRow(userId);
  if (!row || row.confirmed_at != null) return null;

  const step = verifyTotp(row.secret, code);
  if (step === null) return null;

  const codes = generateRecoveryCodes();
  const hashed = codes.map((recovery) => ({
    user_id: userId,
    code_hash: hashRecoveryCode(recovery),
  }));

  // Enabling 2FA and issuing the recovery codes must succeed or fail together,
  // otherwise a failure here leaves the account with no backup route in.
  await db().begin(async (tx) => {
    await tx`
      UPDATE totp_credentials
         SET confirmed_at = now(), last_step = ${step}
       WHERE user_id = ${userId}
    `;
    await tx`DELETE FROM recovery_codes WHERE user_id = ${userId}`;
    await tx`INSERT INTO recovery_codes ${tx(hashed, "user_id", "code_hash")}`;
  });

  return codes;
}

/**
 * Verifies a code at the sign-in prompt. Each step is remembered so the same
 * six digits cannot be replayed inside their 30-second window.
 */
export async function consumeTotp(
  userId: string,
  code: string,
): Promise<boolean> {
  const row = await totpRow(userId);
  if (!row || row.confirmed_at == null) return false;

  const step = verifyTotp(row.secret, code);
  if (step === null) return false;
  if (row.last_step != null && step <= row.last_step) return false;

  // The replay guard is repeated in SQL: two submissions of the same code can
  // both clear the check above, and only one of them may win the update.
  const result = await db()`
    UPDATE totp_credentials
       SET last_step = ${step}
     WHERE user_id = ${userId}
       AND (last_step IS NULL OR last_step < ${step})
  `;
  return result.count > 0;
}

export async function consumeRecoveryCode(
  userId: string,
  code: string,
): Promise<boolean> {
  const result = await db()`
    UPDATE recovery_codes SET used_at = now()
     WHERE user_id = ${userId}
       AND code_hash = ${hashRecoveryCode(code)}
       AND used_at IS NULL
  `;
  return result.count > 0;
}

export async function countRecoveryCodes(userId: string): Promise<number> {
  const [{ count }] = await db()<Array<{ count: number }>>`
    SELECT COUNT(*) AS count FROM recovery_codes
     WHERE user_id = ${userId} AND used_at IS NULL
  `;
  return count;
}

export async function disableTwoFactor(userId: string) {
  await db().begin(async (tx) => {
    await tx`DELETE FROM totp_credentials WHERE user_id = ${userId}`;
    await tx`DELETE FROM recovery_codes WHERE user_id = ${userId}`;
  });
}

/** Exposed for the sign-in callback, which must gate the session before issuing it. */
export async function requiresTwoFactor(userId: string): Promise<boolean> {
  return twoFactorEnabled(userId);
}

export { currentStep };
