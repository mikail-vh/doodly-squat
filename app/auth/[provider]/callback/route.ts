import { NextResponse, type NextRequest } from "next/server";
import {
  OAUTH_RETURN_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  SESSION_COOKIE,
  createSession,
  linkOrCreateUser,
  requiresTwoFactor,
  sessionCookieOptions,
} from "@/lib/auth";
import {
  appBaseUrl,
  getProvider,
  redirectUriFor,
  resolveProfile,
  safeReturnPath,
} from "@/lib/oauth";

type Context = { params: Promise<{ provider: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  const { provider: id } = await params;
  const base = appBaseUrl(request);
  const fail = (reason: string) =>
    NextResponse.redirect(`${base}/signin?error=${reason}`);

  const provider = getProvider(id);
  if (!provider) return fail("provider");

  const query = request.nextUrl.searchParams;
  if (query.get("error")) return fail("denied");

  const code = query.get("code");
  const state = query.get("state");
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const verifier = request.cookies.get(OAUTH_VERIFIER_COOKIE)?.value;
  const next = safeReturnPath(request.cookies.get(OAUTH_RETURN_COOKIE)?.value);

  // A missing or mismatched state means this callback was not one we started.
  if (!code || !state || !expectedState || !verifier || state !== expectedState) {
    return fail("state");
  }

  const profile = await resolveProfile(
    provider,
    code,
    redirectUriFor(request, provider),
    verifier,
  );
  if (!profile) return fail("exchange");

  const user = linkOrCreateUser(provider, profile);
  const needsTotp = requiresTwoFactor(user.id);
  const token = createSession(user.id, needsTotp);

  const destination = needsTotp
    ? `/signin/two-factor?next=${encodeURIComponent(next)}`
    : next;

  const response = NextResponse.redirect(`${base}${destination}`);
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  for (const name of [
    OAUTH_STATE_COOKIE,
    OAUTH_VERIFIER_COOKIE,
    OAUTH_RETURN_COOKIE,
  ]) {
    response.cookies.delete(name);
  }
  return response;
}
