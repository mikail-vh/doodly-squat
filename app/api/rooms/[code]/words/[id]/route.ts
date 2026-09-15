import { NextResponse } from "next/server";
import { deleteWord, listWords } from "@/lib/words";

type Context = { params: Promise<{ code: string; id: string }> };

export async function DELETE(_request: Request, { params }: Context) {
  const { code, id } = await params;
  const wordId = Number(id);
  if (!Number.isInteger(wordId)) {
    return NextResponse.json({ error: "Bad word id" }, { status: 400 });
  }
  if (!deleteWord(code, wordId)) {
    return NextResponse.json({ error: "Word not found" }, { status: 404 });
  }
  return NextResponse.json({ words: listWords(code) });
}
