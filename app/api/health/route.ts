import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Proves the process is up and Postgres answers. The keep-alive Action pings
 * this twice a week, which is what stops a free Supabase project pausing.
 */
export async function GET() {
  try {
    await db()`SELECT 1`;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
