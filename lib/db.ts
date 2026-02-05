import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import crypto from "crypto";

export type ChatSummary = {
  id: string;
  space: number;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredMessage = {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
};

let db: Database.Database | null = null;

function getDb() {
  if (!db) {
    const dbPath = path.join(process.cwd(), "data", "chat.db");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        space INTEGER NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        images_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
      );
    `);
  }

  return db;
}

function mapChat(row: any): ChatSummary {
  return {
    id: row.id,
    space: row.space,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeTitle(text: string) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Новый чат";
  if (cleaned.length <= 60) return cleaned;
  return `${cleaned.slice(0, 57)}...`;
}

export function listChats(space: number): ChatSummary[] {
  const rows = getDb()
    .prepare(
      "SELECT id, space, title, created_at, updated_at FROM chats WHERE space = ? ORDER BY updated_at DESC"
    )
    .all(space);
  return rows.map(mapChat);
}

export function getChat(chatId: string): ChatSummary | null {
  const row = getDb()
    .prepare(
      "SELECT id, space, title, created_at, updated_at FROM chats WHERE id = ?"
    )
    .get(chatId);
  return row ? mapChat(row) : null;
}

export function createChat(space: number, title = "Новый чат"): ChatSummary {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "INSERT INTO chats (id, space, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(id, space, title, now, now);
  return { id, space, title, createdAt: now, updatedAt: now };
}

export function listMessages(chatId: string): StoredMessage[] {
  const rows = getDb()
    .prepare(
      "SELECT id, chat_id, role, text, images_json, created_at FROM messages WHERE chat_id = ? ORDER BY created_at ASC"
    )
    .all(chatId);

  return rows.map((row: any) => ({
    id: row.id,
    chatId: row.chat_id,
    role: row.role,
    text: row.text,
    createdAt: row.created_at
  }));
}

export function addMessage(
  chatId: string,
  role: "user" | "assistant",
  text: string
): StoredMessage {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const imagesJson = null;

  getDb()
    .prepare(
      "INSERT INTO messages (id, chat_id, role, text, images_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(id, chatId, role, text, imagesJson, now);

  getDb()
    .prepare("UPDATE chats SET updated_at = ? WHERE id = ?")
    .run(now, chatId);

  return {
    id,
    chatId,
    role,
    text,
    createdAt: now
  };
}

export function updateChatTitleIfDefault(chatId: string, text: string) {
  const row = getDb()
    .prepare("SELECT title FROM chats WHERE id = ?")
    .get(chatId);

  if (!row || row.title !== "Новый чат") {
    return;
  }

  const title = normalizeTitle(text);
  getDb().prepare("UPDATE chats SET title = ? WHERE id = ?").run(title, chatId);
}

export function deleteChat(chatId: string) {
  const database = getDb();
  const tx = database.transaction((id: string) => {
    database.prepare("DELETE FROM messages WHERE chat_id = ?").run(id);
    return database.prepare("DELETE FROM chats WHERE id = ?").run(id).changes;
  });

  return tx(chatId) > 0;
}
