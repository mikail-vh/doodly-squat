import crypto from "node:crypto";

/**
 * Authorization Code flow with PKCE, hand-rolled on fetch. Both providers are
 * optional: one is enabled as soon as its client id and secret are present, so
 * you can run Discord-only until you get round to registering a Google app.
 */
export type ProviderId = "discord" | "google";

export type OAuthProfile = {
  providerId: string;
  displayName: string;
  /** Only ever set when the provider says the address is verified. */
  email: string | null;
  avatarUrl: string | null;
};

type Raw = Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

type Definition = {
  id: ProviderId;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scope: string;
  authorizeParams?: Record<string, string>;
  normalize: (raw: Raw) => OAuthProfile | null;
};

const DEFINITIONS: Record<ProviderId, Definition> = {
  discord: {
    id: "discord",
    label: "Discord",
    authorizeUrl: "https://discord.com/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    userInfoUrl: "https://discord.com/api/users/@me",
    scope: "identify email",
    normalize: (raw) => {
      const id = text(raw.id);
      if (!id) return null;
      const avatar = text(raw.avatar);
      return {
        providerId: id,
        displayName: text(raw.global_name) ?? text(raw.username) ?? "Player",
        email: raw.verified === true ? text(raw.email) : null,
        avatarUrl: avatar
          ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.${avatar.startsWith("a_") ? "gif" : "png"}?size=128`
          : null,
      };
    },
  },
  google: {
    id: "google",
    label: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email profile",
    authorizeParams: { access_type: "online", prompt: "select_account" },
    normalize: (raw) => {
      const id = text(raw.sub);
      if (!id) return null;
      return {
        providerId: id,
        displayName: text(raw.name) ?? text(raw.given_name) ?? "Player",
        email: raw.email_verified === true ? text(raw.email) : null,
        avatarUrl: text(raw.picture),
      };
    },
  },
};

export type Provider = Definition & { clientId: string; clientSecret: string };

function credentials(id: ProviderId) {
  const prefix = id.toUpperCase();
  return {
    clientId: process.env[`${prefix}_CLIENT_ID`] ?? "",
    clientSecret: process.env[`${prefix}_CLIENT_SECRET`] ?? "",
  };
}

export function getProvider(id: string): Provider | null {
  const definition = DEFINITIONS[id as ProviderId];
  if (!definition) return null;
  const { clientId, clientSecret } = credentials(definition.id);
  if (!clientId || !clientSecret) return null;
  return { ...definition, clientId, clientSecret };
}

export function enabledProviders(): Provider[] {
  return (Object.keys(DEFINITIONS) as ProviderId[])
    .map(getProvider)
    .filter((provider): provider is Provider => provider !== null);
}

/**
 * Behind Caddy the app sees http on an internal port, so trust the forwarded
 * headers. Set APP_URL to pin it explicitly — the redirect URI has to match
 * what you registered with the provider, character for character.
 */
export function appBaseUrl(request: Request): string {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;

  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto =
    request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export function redirectUriFor(request: Request, provider: Provider) {
  return `${appBaseUrl(request)}/auth/${provider.id}/callback`;
}

function base64url(bytes: Buffer) {
  return bytes.toString("base64url");
}

export function randomToken(bytes = 32) {
  return base64url(crypto.randomBytes(bytes));
}

export function pkceChallenge(verifier: string) {
  return base64url(crypto.createHash("sha256").update(verifier).digest());
}

export function authorizeUrl(
  provider: Provider,
  redirectUri: string,
  state: string,
  verifier: string,
) {
  const params = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: provider.scope,
    state,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: "S256",
    ...provider.authorizeParams,
  });
  return `${provider.authorizeUrl}?${params.toString()}`;
}

async function exchangeCode(
  provider: Provider,
  code: string,
  redirectUri: string,
  verifier: string,
): Promise<string | null> {
  const response = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });

  if (!response.ok) return null;
  const payload = (await response.json()) as Raw;
  return text(payload.access_token);
}

/** Swaps the callback code for the account's public profile. */
export async function resolveProfile(
  provider: Provider,
  code: string,
  redirectUri: string,
  verifier: string,
): Promise<OAuthProfile | null> {
  const accessToken = await exchangeCode(provider, code, redirectUri, verifier);
  if (!accessToken) return null;

  const response = await fetch(provider.userInfoUrl, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  if (!response.ok) return null;

  return provider.normalize((await response.json()) as Raw);
}

/** Guards the post-sign-in redirect against being pointed at another site. */
export function safeReturnPath(value: string | null | undefined, fallback = "/account") {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}
