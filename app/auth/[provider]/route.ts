import { NextResponse } from "next/server";
import {
  OAUTH_RETURN_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  transientCookieOptions,
} from "@/lib/auth";
import {
  appBaseUrl,
  authorizeUrl,
  getProvider,
  randomToken,
  redirectUriFor,
  safeReturnPath,
} from "@/lib/oauth";

type Context = { params: Promise<{ provider: string }> };

/** Kicks off the Authorization Code + PKCE dance. */
export async function GET(request: Request, { params }: Context) {
  const { provider: id } = await params;
  const base = appBaseUrl(request);
  const provider = getProvider(id);

  if (!provider) {
    return NextResponse.redirect(`${base}/signin?error=provider`);
  }

  const state = randomToken(16);
  const verifier = randomToken(32);
  const next = safeReturnPath(new URL(request.url).searchParams.get("next"));

  const response = NextResponse.redirect(
    authorizeUrl(provider, redirectUriFor(request, provider), state, verifier),
  );
  const options = transientCookieOptions();
  response.cookies.set(OAUTH_STATE_COOKIE, state, options);
  response.cookies.set(OAUTH_VERIFIER_COOKIE, verifier, options);
  response.cookies.set(OAUTH_RETURN_COOKIE, next, options);
  return response;
}
