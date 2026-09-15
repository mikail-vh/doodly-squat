import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/** Used by the Docker healthcheck: proves the process is up and the DB opens. */
export async function GET() {
  try {
    db().prepare("SELECT 1").get();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
