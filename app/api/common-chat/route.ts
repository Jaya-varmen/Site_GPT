import { NextResponse } from "next/server";
import { addCommonChatMessage, listCommonChatMessages } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rawLimit = Number(searchParams.get("limit") ?? "80");
  const limit = Number.isFinite(rawLimit) ? rawLimit : 80;

  const messages = listCommonChatMessages(limit);
  return NextResponse.json(
    { messages },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const senderId = typeof body?.senderId === "string" ? body.senderId.trim() : "";
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!senderId) {
    return NextResponse.json({ error: "senderId is required" }, { status: 400 });
  }

  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  if (text.length > 1000) {
    return NextResponse.json(
      { error: "Сообщение слишком длинное. Максимум 1000 символов." },
      { status: 400 }
    );
  }

  const message = addCommonChatMessage(senderId, text);
  return NextResponse.json({ message }, { headers: { "Cache-Control": "no-store" } });
}
