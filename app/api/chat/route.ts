import crypto from "crypto";
import OpenAI from "openai";
import mammoth from "mammoth";
import { NextResponse } from "next/server";
import {
  addMessage,
  getChat,
  listMessages,
  updateChatTitleIfDefault
} from "@/lib/db";

type Provider = "openai" | "gemini";

type ContentPart =
  | { type: "input_text" | "output_text"; text: string }
  | { type: "input_image"; image_url: string }
  | { type: "input_file"; file_data: string; filename: string };

type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

type IncomingFile = {
  name: string;
  type?: string;
  data: string;
  size?: number;
};

type HistoryMessage = {
  role: "user" | "assistant";
  text: string;
};

const OPENAI_MODEL = "gpt-5.2";
const GEMINI_MODEL = "gemini-2.5-flash";

const MAX_IMAGES = 6;
const MAX_FILES = 5;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_HISTORY_MESSAGES = 40;

let openAiClient: OpenAI | null = null;

function getOpenAiClient(apiKey: string) {
  if (!openAiClient) {
    openAiClient = new OpenAI({ apiKey });
  }
  return openAiClient;
}

function stripDataUrlPrefix(data: string) {
  return data.includes(",") ? data.split(",")[1] : data;
}

function parseImageData(imageUrl: string) {
  const match = imageUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) {
    throw new Error("Некорректный формат изображения.");
  }

  const mimeType = match[1];
  const data = match[2];
  const bytes = Buffer.from(data, "base64").byteLength;

  return {
    mimeType,
    data,
    bytes
  };
}

function getFileMimeType(file: IncomingFile) {
  const type = typeof file.type === "string" ? file.type : "";
  if (type) return type;

  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".pdf")) return "application/pdf";
  if (lowerName.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lowerName.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lowerName.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lowerName.endsWith(".csv")) return "text/csv";
  return "application/octet-stream";
}

function isDocx(mimeType: string, fileName: string) {
  const lowerName = fileName.toLowerCase();
  return (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lowerName.endsWith(".docx")
  );
}

function isCsv(mimeType: string, fileName: string) {
  const lowerName = fileName.toLowerCase();
  return mimeType === "text/csv" || lowerName.endsWith(".csv");
}

function isSupportedBinaryFile(mimeType: string, fileName: string) {
  const lowerName = fileName.toLowerCase();
  return (
    mimeType === "application/pdf" ||
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel" ||
    lowerName.endsWith(".pdf") ||
    lowerName.endsWith(".xlsx") ||
    lowerName.endsWith(".xls")
  );
}

function parseHistory(bodyHistory: unknown): HistoryMessage[] {
  if (!Array.isArray(bodyHistory)) return [];

  return bodyHistory
    .filter((item): item is HistoryMessage => {
      return (
        item !== null &&
        typeof item === "object" &&
        (item as HistoryMessage).role !== undefined &&
        (item as HistoryMessage).text !== undefined
      );
    })
    .map((item): HistoryMessage => ({
      role: item.role === "assistant" ? "assistant" : "user",
      text: typeof item.text === "string" ? item.text.trim() : ""
    }))
    .filter((item) => item.text.length > 0)
    .slice(-MAX_HISTORY_MESSAGES);
}

function extractOpenAiOutputText(response: unknown) {
  const responseAny = response as {
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

  return outputText.trim();
}

function extractGeminiOutputText(payload: unknown) {
  const parsed = payload as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  return (
    parsed.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim() ?? ""
  );
}

function isNetworkError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("enotfound") ||
    message.includes("econnreset") ||
    message.includes("eai_again") ||
    message.includes("aborted")
  );
}

function mapProviderError(provider: Provider, error: unknown) {
  if (isNetworkError(error)) {
    if (provider === "gemini") {
      return "Не удалось подключиться к Gemini API. Проверьте интернет, GEMINI_API_KEY и доступ к Google API (в некоторых сетях нужен VPN).";
    }
    return "Не удалось подключиться к OpenAI API. Проверьте интернет, OPENAI_API_KEY и доступ к api.openai.com.";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Неизвестная ошибка";
}

export const runtime = "nodejs";

export async function POST(req: Request) {
  let provider: Provider = "openai";

  try {
    const body = await req.json();

    provider = body?.provider === "gemini" ? "gemini" : "openai";
    const ephemeral = Boolean(body?.ephemeral);
    const chatId = typeof body?.chatId === "string" ? body.chatId : null;

    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const images = Array.isArray(body?.images)
      ? body.images.filter((item: unknown) => typeof item === "string")
      : [];

    const files = Array.isArray(body?.files)
      ? (body.files.filter(
          (item: IncomingFile) =>
            item && typeof item.name === "string" && typeof item.data === "string"
        ) as IncomingFile[])
      : [];

    if (!text && images.length === 0 && files.length === 0) {
      return NextResponse.json(
        { error: "Нужно текстовое сообщение, изображения или файлы" },
        { status: 400 }
      );
    }

    if (images.length > MAX_IMAGES) {
      return NextResponse.json(
        { error: `Можно прикрепить до ${MAX_IMAGES} изображений.` },
        { status: 400 }
      );
    }

    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `Можно прикрепить до ${MAX_FILES} файлов.` },
        { status: 400 }
      );
    }

    if (!ephemeral && !chatId) {
      return NextResponse.json({ error: "chatId обязателен" }, { status: 400 });
    }

    if (!ephemeral && chatId && !getChat(chatId)) {
      return NextResponse.json({ error: "Чат не найден" }, { status: 404 });
    }

    const history = ephemeral
      ? parseHistory(body?.history)
      : chatId
        ? listMessages(chatId)
            .map((message) => ({
              role: message.role,
              text: message.text.trim()
            }))
            .filter((message) => message.text.length > 0)
            .slice(-MAX_HISTORY_MESSAGES)
        : [];

    const openAiCurrentContent: ContentPart[] = [];
    const geminiCurrentContent: GeminiPart[] = [];

    if (text) {
      openAiCurrentContent.push({ type: "input_text", text });
      geminiCurrentContent.push({ text });
    }

    for (const image of images) {
      let imagePayload: { mimeType: string; data: string; bytes: number };
      try {
        imagePayload = parseImageData(image);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Некорректное изображение.";
        return NextResponse.json({ error: message }, { status: 400 });
      }

      if (imagePayload.bytes > MAX_IMAGE_BYTES) {
        return NextResponse.json(
          { error: `Изображение слишком большое. Лимит ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.` },
          { status: 400 }
        );
      }

      openAiCurrentContent.push({ type: "input_image", image_url: image });
      geminiCurrentContent.push({
        inline_data: {
          mime_type: imagePayload.mimeType,
          data: imagePayload.data
        }
      });
    }

    for (const file of files) {
      const fileName = file.name || "document";
      const normalized = stripDataUrlPrefix(file.data);
      const mimeType = getFileMimeType(file);
      let byteLength = 0;

      try {
        byteLength = Buffer.from(normalized, "base64").byteLength;
      } catch {
        return NextResponse.json(
          { error: `Файл ${fileName} имеет некорректный формат.` },
          { status: 400 }
        );
      }

      if (byteLength > MAX_FILE_BYTES) {
        return NextResponse.json(
          {
            error: `Файл ${fileName} слишком большой. Максимум ${MAX_FILE_BYTES / (1024 * 1024)} MB.`
          },
          { status: 400 }
        );
      }

      if (isDocx(mimeType, fileName)) {
        try {
          const buffer = Buffer.from(normalized, "base64");
          const result = await mammoth.extractRawText({ buffer });
          const docText = result.value?.trim();
          if (!docText) {
            return NextResponse.json(
              { error: `Файл ${fileName} пустой или без текста` },
              { status: 400 }
            );
          }

          const formatted = `Содержимое файла ${fileName}:\n${docText}`;
          openAiCurrentContent.push({ type: "input_text", text: formatted });
          geminiCurrentContent.push({ text: formatted });
        } catch {
          return NextResponse.json(
            { error: `Не удалось прочитать файл ${fileName}.` },
            { status: 400 }
          );
        }

        continue;
      }

      if (isCsv(mimeType, fileName)) {
        try {
          const csvText = Buffer.from(normalized, "base64").toString("utf8").trim();
          if (!csvText) {
            return NextResponse.json(
              { error: `Файл ${fileName} пустой.` },
              { status: 400 }
            );
          }

          const formatted = `Содержимое таблицы ${fileName}:\n${csvText}`;
          openAiCurrentContent.push({ type: "input_text", text: formatted });
          geminiCurrentContent.push({ text: formatted });
        } catch {
          return NextResponse.json(
            { error: `Не удалось прочитать CSV файл ${fileName}.` },
            { status: 400 }
          );
        }

        continue;
      }

      if (!isSupportedBinaryFile(mimeType, fileName)) {
        return NextResponse.json(
          { error: `Файл ${fileName} не поддерживается.` },
          { status: 400 }
        );
      }

      openAiCurrentContent.push({
        type: "input_file",
        file_data: normalized,
        filename: fileName
      });

      geminiCurrentContent.push({
        inline_data: {
          mime_type: mimeType,
          data: normalized
        }
      });
    }

    if (openAiCurrentContent.length === 0 || geminiCurrentContent.length === 0) {
      return NextResponse.json(
        { error: "Нет подходящего содержимого сообщения" },
        { status: 400 }
      );
    }

    const openAiHistory = history.map((message) => ({
      type: "message" as const,
      role: message.role,
      content: [
        {
          type: message.role === "assistant" ? "output_text" : "input_text",
          text: message.text
        }
      ]
    }));

    const geminiHistory = history.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.text }]
    }));

    let outputText = "";

    if (provider === "openai") {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return NextResponse.json(
          { error: "OPENAI_API_KEY is not configured" },
          { status: 500 }
        );
      }

      const response = await getOpenAiClient(apiKey).responses.create({
        model: OPENAI_MODEL,
        input: [
          ...openAiHistory,
          { type: "message", role: "user", content: openAiCurrentContent }
        ] as any
      });

      outputText = extractOpenAiOutputText(response);
    } else {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return NextResponse.json(
          { error: "GEMINI_API_KEY is not configured" },
          { status: 500 }
        );
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000);
      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: [
              ...geminiHistory,
              {
                role: "user",
                parts: geminiCurrentContent
              }
            ]
          }),
          signal: controller.signal
        }
      ).finally(() => clearTimeout(timeout));

      const geminiPayload = await geminiResponse.json().catch(() => ({}));

      if (!geminiResponse.ok) {
        const apiError =
          typeof (geminiPayload as { error?: { message?: string } })?.error?.message ===
          "string"
            ? (geminiPayload as { error: { message: string } }).error.message
            : "Gemini API вернул ошибку.";

        return NextResponse.json({ error: apiError }, { status: 500 });
      }

      outputText = extractGeminiOutputText(geminiPayload);
    }

    if (!outputText) {
      return NextResponse.json(
        { error: "Модель не вернула текстовый ответ." },
        { status: 500 }
      );
    }

    let assistantMessageId: string = crypto.randomUUID();

    if (!ephemeral && chatId) {
      addMessage(chatId, "user", text);
      if (text) {
        updateChatTitleIfDefault(chatId, text);
      }
      const assistantMessage = addMessage(chatId, "assistant", outputText);
      assistantMessageId = assistantMessage.id;
    }

    return NextResponse.json({
      output: outputText,
      assistantMessage: { id: assistantMessageId }
    });
  } catch (error) {
    const message = mapProviderError(provider, error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
