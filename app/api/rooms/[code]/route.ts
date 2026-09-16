import { NextResponse } from "next/server";
import { getRoom, listWords, renameRoom } from "@/lib/words";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ code: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { code } = await params;
  const [room, words] = await Promise.all([getRoom(code), listWords(code)]);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  return NextResponse.json({ room, words });
}

export async function PATCH(request: Request, { params }: Context) {
  const { code } = await params;
  if (!(await getRoom(code))) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  if (typeof body.name !== "string") {
    return NextResponse.json({ error: "A name is required" }, { status: 400 });
  }
  return NextResponse.json({ room: await renameRoom(code, body.name) });
}
