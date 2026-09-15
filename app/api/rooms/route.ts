import { NextResponse } from "next/server";
import { createRoom } from "@/lib/words";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const room = createRoom(typeof body.name === "string" ? body.name : "");
  return NextResponse.json({ room }, { status: 201 });
}
