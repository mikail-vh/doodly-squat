import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getRoom, listWords } from "@/lib/words";
import RoomDashboard from "./room-dashboard";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const room = getRoom(code);
  return {
    title: room ? `${room.name} · Doodly Squat` : "Stash not found",
  };
}

export default async function RoomPage({ params }: Props) {
  const { code } = await params;
  const room = getRoom(code);
  if (!room) notFound();
  return <RoomDashboard room={room} initialWords={listWords(room.code)} />;
}
