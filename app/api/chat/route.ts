import OpenAI from "openai";
import mammoth from "mammoth";
import { NextResponse } from "next/server";
import {
  addMessage,
  getChat,
  listMessages,
  updateChatTitleIfDefault
} from "@/lib/db";

type ContentPart =
  | { type: "input_text" | "output_text"; text: string }
  | { type: "input_image"; image_url: string }
  | { type: "input_file"; file_data: string; filename: string };

type IncomingFile = {
  name: string;
  type: string;
  data: string;
  size?: number;
};

let client: OpenAI | null = null;

function getClient(apiKey: string) {
  if (!client) {
    client = new OpenAI({ apiKey });
  }
  return client;
}

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is not configured" },
        { status: 500 }
      );
    }

    const body = await req.json();
    const chatId = typeof body?.chatId === "string" ? body.chatId : null;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const images = Array.isArray(body?.images)
      ? body.images.filter((item: unknown) => typeof item === "string")
      : [];
    const files = Array.isArray(body?.files)
      ? (body.files.filter(
          (item: IncomingFile) =>
            item &&
            typeof item.name === "string" &&
            typeof item.data === "string"
        ) as IncomingFile[])
      : [];

    if (!chatId) {
      return NextResponse.json(
        { error: "chatId обязателен" },
        { status: 400 }
      );
    }

    if (!text && images.length === 0 && files.length === 0) {
      return NextResponse.json(
        { error: "Нужно текстовое сообщение, изображения или файлы" },
        { status: 400 }
      );
    }

    const chat = getChat(chatId);
    if (!chat) {
      return NextResponse.json({ error: "Чат не найден" }, { status: 404 });
    }

    const history = listMessages(chatId);
    const userMessage = addMessage(chatId, "user", text);

    if (text) {
      updateChatTitleIfDefault(chatId, text);
    }

    const input = history
      .map((message) => {
        const messageText = message.text?.trim();
        if (!messageText) return null;
        return {
          type: "message",
          role: message.role,
          content: [
            {
              type: message.role === "assistant" ? "output_text" : "input_text",
              text: messageText
            }
          ]
        };
      })
      .filter(Boolean) as Array<{
      type: "message";
      role: "user" | "assistant";
      content: ContentPart[];
    }>;

    const currentContent: ContentPart[] = [];
    if (text) {
      currentContent.push({ type: "input_text", text });
    }
    if (images.length) {
      for (const image of images) {
        currentContent.push({ type: "input_image", image_url: image });
      }
    }

    if (files.length) {
      for (const file of files) {
        const name = file.name ?? "document";
        const normalized = file.data.includes(",")
          ? file.data.split(",")[1]
          : file.data;
        const lower = name.toLowerCase();
        const isPdf =
          file.type === "application/pdf" || lower.endsWith(".pdf");
        const isDocx =
          file.type ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
          lower.endsWith(".docx");

        if (isPdf) {
          currentContent.push({
            type: "input_file",
            file_data: normalized,
            filename: name
          });
        } else if (isDocx) {
          try {
            const buffer = Buffer.from(normalized, "base64");
            const result = await mammoth.extractRawText({ buffer });
            const docText = result.value?.trim();
            if (docText) {
              currentContent.push({
                type: "input_text",
                text: `Содержимое файла ${name}:\n${docText}`
              });
            } else {
              return NextResponse.json(
                { error: `Файл ${name} пустой или без текста` },
                { status: 400 }
              );
            }
          } catch {
            return NextResponse.json(
              { error: `Не удалось прочитать файл ${name}. Попробуйте PDF.` },
              { status: 400 }
            );
          }
        }
      }
    }

    if (currentContent.length === 0) {
      return NextResponse.json(
        { error: "Нет подходящего содержимого сообщения" },
        { status: 400 }
      );
    }

    input.push({ type: "message", role: "user", content: currentContent });

    if (input.length === 0) {
      return NextResponse.json(
        { error: "Нет подходящего содержимого сообщения" },
        { status: 400 }
      );
    }

    const response = await getClient(apiKey).responses.create({
      model: "gpt-5.2",
      // SDK types are stricter than the runtime accepts for message arrays.
      // Cast to any to avoid build-time type mismatch in Next.js.
      input: input as any
    });

    const responseAny = response as unknown as {
      output_text?: string;
      output?: Array<{ content?: Array<{ type: string; text?: string }> }>;
    };

    const outputText =
      responseAny.output_text ??
      responseAny.output
        ?.flatMap((item) => item.content ?? [])
        .filter((item) => item.type === "output_text")
        .map((item) => item.text ?? "")
        .join("") ??
      "";

    const assistantMessage = addMessage(chatId, "assistant", outputText);

    return NextResponse.json({
      output: outputText,
      assistantMessage
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Неизвестная ошибка";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
