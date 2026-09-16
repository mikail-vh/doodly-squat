import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { recordResults, type ResultInput } from "@/lib/stats";

/**
 * Ingest endpoint for the game server we will self-host. Authenticated with a
 * single shared secret in STATS_INGEST_TOKEN; the route stays disabled until
 * that is set, so an unconfigured instance cannot be written to.
 */
function authorized(request: Request): boolean {
  const expected = process.env.STATS_INGEST_TOKEN ?? "";
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const presented = header.replace(/^Bearer\s+/i, "");
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const matchId = typeof body?.matchId === "string" ? body.matchId.slice(0, 64) : "";
  const players: ResultInput[] = Array.isArray(body?.players) ? body.players : [];

  if (!matchId || players.length === 0) {
    return NextResponse.json(
      { error: "matchId and a non-empty players array are required" },
      { status: 400 },
    );
  }

  const playedAt = Number.isFinite(body?.playedAt) ? Number(body.playedAt) : Date.now();
  const recorded = await recordResults(matchId, playedAt, players);

  return NextResponse.json({ matchId, recorded }, { status: 201 });
}
