import { NextResponse } from "next/server";
import { createChat, deleteChat, getChat, listChats, listMessages } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const chatId = searchParams.get("id");

  if (chatId) {
    const chat = getChat(chatId);
    if (!chat) {
      return NextResponse.json(
        { error: "Chat not found" },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }
    const messages = listMessages(chatId);
    return NextResponse.json(
      { chat, messages },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  const space = Number(searchParams.get("space") ?? "1");

  if (![1, 2, 3].includes(space)) {
    return NextResponse.json({ error: "Invalid space" }, { status: 400 });
  }

  const chats = listChats(space);
  return NextResponse.json(
    { chats },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: Request) {
  const body = await req.json();
  const space = Number(body?.space ?? 1);
  const title = typeof body?.title === "string" ? body.title : "Новый чат";

  if (![1, 2, 3].includes(space)) {
    return NextResponse.json({ error: "Invalid space" }, { status: 400 });
  }

  const chat = createChat(space, title);
  return NextResponse.json(
    { chat },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}));
  const url = new URL(req.url);
  const chatId =
    typeof body?.chatId === "string"
      ? body.chatId
      : url.searchParams.get("id");

  if (!chatId) {
    return NextResponse.json({ error: "chatId is required" }, { status: 400 });
  }

  const removed = deleteChat(chatId);
  if (!removed) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
