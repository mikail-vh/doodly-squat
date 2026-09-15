import crypto from "node:crypto";

/**
 * RFC 6238 TOTP over RFC 4648 base32, implemented on node:crypto so there is
 * no dependency to audit. Standard 30-second steps and 6 digits, which is what
 * every authenticator app assumes by default.
 */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;
/** One step either side, to forgive a slightly wrong phone clock. */
const DRIFT_STEPS = 1;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const character of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(bytes);
}

/** 160 bits, the size RFC 4226 recommends for HMAC-SHA1. */
export function generateSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secret: Uint8Array, counter: bigint): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = crypto
    .createHmac("sha1", Buffer.from(secret))
    .update(message)
    .digest();

  // Dynamic truncation, RFC 4226 section 5.3.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];

  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

function equals(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function currentStep(now = Date.now()) {
  return Math.floor(now / 1000 / STEP_SECONDS);
}

/**
 * Returns the step the code belongs to, or null when it does not match. The
 * caller stores that step so the same code cannot be replayed.
 */
export function verifyTotp(
  secret: string,
  token: string,
  now = Date.now(),
): number | null {
  const code = token.replace(/\D/g, "");
  if (code.length !== DIGITS) return null;

  const key = base32Decode(secret);
  if (key.length === 0) return null;

  const step = currentStep(now);
  for (let drift = -DRIFT_STEPS; drift <= DRIFT_STEPS; drift++) {
    if (equals(hotp(key, BigInt(step + drift)), code)) return step + drift;
  }
  return null;
}

/** The otpauth:// URI an authenticator app scans or accepts pasted. */
export function otpauthUri(secret: string, account: string, issuer: string) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** Ten single-use codes, shown once and stored only as hashes. */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let index = 0; index < count; index++) {
    const bytes = crypto.randomBytes(10);
    const body = Array.from(
      bytes,
      (byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length],
    ).join("");
    codes.push(`${body.slice(0, 5)}-${body.slice(5)}`);
  }
  return codes;
}

export function hashRecoveryCode(code: string): string {
  const normalized = code.toLowerCase().replace(/[^a-z0-9]/g, "");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}
