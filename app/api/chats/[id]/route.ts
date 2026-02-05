import { NextResponse } from "next/server";
import { deleteChat, getChat, listMessages } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const chatId = params.id;
  const chat = getChat(chatId);

  if (!chat) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  const messages = listMessages(chatId);
  return NextResponse.json(
    { chat, messages },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  const chatId = params.id;
  const removed = deleteChat(chatId);

  if (!removed) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } }
  );
}
