import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { addWords, clearWords, getRoom, listWords } from "@/lib/words";

type Context = { params: Promise<{ code: string }> };

export async function POST(request: Request, { params }: Context) {
  const { code } = await params;
  if (!(await getRoom(code))) {
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
  // The re-read has to follow the insert, so these two stay sequential.
  const added = await addWords(code, body.text, addedBy, user?.id ?? null);
  const words = await listWords(code);
  return NextResponse.json({ added, words }, { status: 201 });
}

export async function DELETE(_request: Request, { params }: Context) {
  const { code } = await params;
  if (!(await getRoom(code))) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  return NextResponse.json({ removed: await clearWords(code), words: [] });
}
