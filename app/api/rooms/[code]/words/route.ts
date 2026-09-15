import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { addWords, clearWords, getRoom, listWords } from "@/lib/words";

type Context = { params: Promise<{ code: string }> };

export async function POST(request: Request, { params }: Context) {
  const { code } = await params;
  if (!getRoom(code)) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  if (typeof body.text !== "string" || !body.text.trim()) {
    return NextResponse.json({ error: "Nothing to add" }, { status: 400 });
  }
  // A signed-in account owns its words; everyone else keeps the nickname flow.
  const user = await currentUser();
  const addedBy =
    user?.displayName ??
    (typeof body.addedBy === "string" ? body.addedBy : "someone");
  const added = addWords(code, body.text, addedBy, user?.id ?? null);
  return NextResponse.json({ added, words: listWords(code) }, { status: 201 });
}

export async function DELETE(_request: Request, { params }: Context) {
  const { code } = await params;
  if (!getRoom(code)) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  return NextResponse.json({ removed: clearWords(code), words: [] });
}
