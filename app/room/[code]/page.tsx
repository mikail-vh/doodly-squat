import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getRoom, listWords } from "@/lib/words";
import RoomDashboard from "./room-dashboard";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const room = await getRoom(code);
  return {
    title: room ? `${room.name} · Doodly Squat` : "Stash not found",
  };
}

export default async function RoomPage({ params }: Props) {
  const { code } = await params;
  // listWords normalises the code itself, so both queries can go at once
  // rather than waiting to learn the stash exists first.
  const [room, words] = await Promise.all([getRoom(code), listWords(code)]);
  if (!room) notFound();
  return <RoomDashboard room={room} initialWords={words} />;
}
