"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  images?: string[];
  files?: { name: string; type: string }[];
};

type ChatSummary = {
  id: string;
  title: string;
  updatedAt: string;
  space: number;
};

const MAX_IMAGES = 6;
const MAX_DOC_FILES = 3;
const MAX_DOC_SIZE_MB = 20;
export default function Home() {
  const [space, setSpace] = useState<1 | 2 | 3>(1);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [pendingDocs, setPendingDocs] = useState<
    { name: string; type: string; data: string; size: number }[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingChats, setIsLoadingChats] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const canSend = useMemo(() => {
    return (
      !isLoading &&
      (input.trim().length > 0 ||
        pendingImages.length > 0 ||
        pendingDocs.length > 0)
    );
  }, [isLoading, input, pendingImages.length, pendingDocs.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    setCurrentChatId(null);
    setMessages([]);
    loadChats(space);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space]);

  const fileToDataUrl = (file: File) => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Не удалось прочитать файл."));
      reader.readAsDataURL(file);
    });
  };

  const fileToBase64 = (file: File) => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result ?? "");
        const base64 = result.includes(",") ? result.split(",")[1] : result;
        resolve(base64);
      };
      reader.onerror = () => reject(new Error("Не удалось прочитать файл."));
      reader.readAsDataURL(file);
    });
  };

  const handleFiles = async (files: FileList | File[]) => {
    setError(null);
    const items = Array.from(files).filter((file) =>
      file.type.startsWith("image/")
    );

    if (items.length === 0) {
      setError("Поддерживаются только изображения.");
      return;
    }

    const availableSlots = Math.max(0, MAX_IMAGES - pendingImages.length);
    if (availableSlots === 0) {
      setError(`Можно прикрепить до ${MAX_IMAGES} изображений.`);
      return;
    }

    const selected = items.slice(0, availableSlots);
    if (items.length > availableSlots) {
      setError(`Добавлены только первые ${availableSlots} изображений.`);
    }

    const dataUrls = await Promise.all(selected.map(fileToDataUrl));
    setPendingImages((prev) => [...prev, ...dataUrls]);
  };

  const handleDocFiles = async (files: FileList | File[]) => {
    setError(null);
    const items = Array.from(files).filter((file) => {
      const name = file.name.toLowerCase();
      return (
        file.type === "application/pdf" ||
        file.type ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        name.endsWith(".pdf") ||
        name.endsWith(".docx")
      );
    });

    if (items.length === 0) {
      setError("Поддерживаются только PDF и DOCX.");
      return;
    }

    const availableSlots = Math.max(0, MAX_DOC_FILES - pendingDocs.length);
    if (availableSlots === 0) {
      setError(`Можно прикрепить до ${MAX_DOC_FILES} файлов.`);
      return;
    }

    const selected = items.slice(0, availableSlots);
    if (items.length > availableSlots) {
      setError(`Добавлены только первые ${availableSlots} файлов.`);
    }

    const oversize = selected.find(
      (file) => file.size > MAX_DOC_SIZE_MB * 1024 * 1024
    );
    if (oversize) {
      setError(
        `Файл ${oversize.name} слишком большой. Максимум ${MAX_DOC_SIZE_MB} MB.`
      );
      return;
    }

    const dataItems = await Promise.all(
      selected.map(async (file) => ({
        name: file.name,
        type: file.type || "",
        size: file.size,
        data: await fileToBase64(file)
      }))
    );
    setPendingDocs((prev) => [...prev, ...dataItems]);
  };

  const loadChats = async (targetSpace: number) => {
    setIsLoadingChats(true);
    try {
      const response = await fetch(`/api/chats?space=${targetSpace}`, {
        cache: "no-store"
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Не удалось загрузить чаты.");
      }
      setChats(payload.chats || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Неизвестная ошибка.";
      setError(message);
    } finally {
      setIsLoadingChats(false);
    }
  };

  const openChat = async (chatId: string) => {
    setIsLoadingMessages(true);
    setCurrentChatId(chatId);
    setError(null);
    try {
      const response = await fetch(`/api/chats?id=${chatId}`, {
        cache: "no-store"
      });
      const payload = await response.json();
      if (!response.ok) {
        if (response.status === 404) {
          setCurrentChatId(null);
          setMessages([]);
          loadChats(space);
        }
        throw new Error(payload?.error || "Не удалось открыть чат.");
      }
      setMessages(payload.messages || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Неизвестная ошибка.";
      setError(message);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const deleteChat = async (chatId: string) => {
    const confirmed = window.confirm("Удалить чат без возможности восстановления?");
    if (!confirmed) return;
    try {
      const response = await fetch("/api/chats", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Не удалось удалить чат.");
      }
      setError(null);
      if (currentChatId === chatId) {
        setCurrentChatId(null);
        setMessages([]);
      }
      loadChats(space);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Неизвестная ошибка.";
      setError(message);
    }
  };

  const createChat = async () => {
    const response = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ space })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || "Не удалось создать чат.");
    }
    const chat = payload.chat as ChatSummary;
    setChats((prev) => [chat, ...prev]);
    setCurrentChatId(chat.id);
    setMessages([]);
    return chat;
  };

  const ensureChat = async () => {
    if (currentChatId) return currentChatId;
    const chat = await createChat();
    return chat.id;
  };

  const formatTimestamp = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const handleSend = async () => {
    if (!canSend) return;

    const activeChatId = await ensureChat();
    const outgoingDocs = pendingDocs;
    const newMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      text: input.trim(),
      images: pendingImages.length ? pendingImages : undefined,
      files: outgoingDocs.length
        ? outgoingDocs.map((file) => ({ name: file.name, type: file.type }))
        : undefined
    };

    setMessages((prev) => [...prev, newMessage]);
    setInput("");
    setPendingImages([]);
    setPendingDocs([]);
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: activeChatId,
          text: newMessage.text,
          images: newMessage.images,
          files: outgoingDocs
        })
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Запрос не выполнен.");
      }

      const assistantMessage: Message = {
        id: payload?.assistantMessage?.id || crypto.randomUUID(),
        role: "assistant",
        text: payload.output || ""
      };

      setMessages((prev) => [...prev, assistantMessage]);
      loadChats(space);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Неизвестная ошибка.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    if (event.dataTransfer.files?.length) {
      await handleFiles(event.dataTransfer.files);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      handleSend();
    }
  };

  const isEmptyState = messages.length === 0 && !isLoading;

  return (
    <main>
      <div className="app-shell">
        <header className="header">
          <div className="brand">
            <div className="title">Neurocube GPT</div>
            <div className="subtitle">Ваш бесплатный GPT помощник.</div>
          </div>
          <div className="header-actions">
            <div className="model-pill">
              Модель <span>gpt-5.2</span>
            </div>
            <div className="space-switch">
              {[1, 2, 3].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`space-button ${space === value ? "active" : ""}`}
                  onClick={() => setSpace(value as 1 | 2 | 3)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="content-grid">
          <aside className="sidebar">
            <div className="sidebar-header">
              <button
                type="button"
                className="link-button sidebar-button"
                onClick={async () => {
                  try {
                    await createChat();
                  } catch (err) {
                    const message =
                      err instanceof Error ? err.message : "Неизвестная ошибка.";
                    setError(message);
                  }
                }}
              >
                Новый чат
              </button>
            </div>

            <div className="chat-list">
              {isLoadingChats ? (
                <div className="muted">Загрузка списка...</div>
              ) : chats.length ? (
                chats.map((chat) => (
                  <div
                    key={chat.id}
                    role="button"
                    tabIndex={0}
                    className={`chat-item ${
                      chat.id === currentChatId ? "active" : ""
                    }`}
                    onClick={() => openChat(chat.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openChat(chat.id);
                      }
                    }}
                  >
                    <div className="chat-main">
                      <div className="chat-title">{chat.title}</div>
                      <div className="chat-meta">
                        {formatTimestamp(chat.updatedAt)}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="chat-delete"
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteChat(chat.id);
                      }}
                      aria-label="Удалить чат"
                      title="Удалить чат"
                    >
                      ×
                    </button>
                  </div>
                ))
              ) : (
                <div className="muted">Пока нет чатов в этом разделе.</div>
              )}
            </div>
          </aside>

          <section className="chat-panel">
          <div className="messages">
            {isEmptyState ? (
              <div className="message">
                <div className="message-role">Система</div>
                <div className="bubble assistant">
                  Выберите чат слева или создайте новый. Можно прикреплять
                  скриншоты. Для отправки используйте Ctrl/Command + Enter.
                </div>
              </div>
            ) : null}

            {messages.map((message) => (
              <div key={message.id} className={`message ${message.role}`}>
                <div className="message-role">
                  {message.role === "user" ? "Вы" : "Ассистент"}
                </div>
                {message.text ? (
                  <div className={`bubble ${message.role}`}>
                    {message.role === "assistant" ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {message.text}
                      </ReactMarkdown>
                    ) : (
                      message.text
                    )}
                  </div>
                ) : null}
                {message.images?.length ? (
                  <div className="image-grid">
                    {message.images.map((image, index) => (
                      <div key={index} className="image-thumb">
                        <img src={image} alt="Загружено пользователем" />
                      </div>
                    ))}
                  </div>
                ) : null}
                {message.files?.length ? (
                  <div className="file-list">
                    {message.files.map((file, index) => (
                      <div key={index} className="file-chip">
                        {file.name}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}

            {isLoading ? (
              <div className="message">
                <div className="message-role">Ассистент</div>
                <div className="bubble assistant">Думаю...</div>
              </div>
            ) : null}
            {isLoadingMessages ? (
              <div className="message">
                <div className="message-role">Система</div>
                <div className="bubble assistant">Загружаю историю...</div>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>

          <div className="composer">
            <div
              className="upload-zone"
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setIsDragActive(false);
              }}
              onDrop={handleDrop}
              style={{
                borderColor: isDragActive
                  ? "rgba(110, 231, 249, 0.9)"
                  : undefined,
                background: isDragActive
                  ? "rgba(110, 231, 249, 0.08)"
                  : undefined
              }}
            >
              <div>
                <strong>Прикрепить скриншоты</strong> (перетащите или выберите)
              </div>
              <div className="upload-actions">
                <label className="link-button">
                  Выбрать файлы
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(event) => {
                      if (event.target.files?.length) {
                        handleFiles(event.target.files);
                        event.target.value = "";
                      }
                    }}
                  />
                </label>
                {pendingImages.length ? (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setPendingImages([])}
                  >
                    Очистить
                  </button>
                ) : null}
              </div>
            </div>

            {pendingImages.length ? (
              <div className="image-grid">
                {pendingImages.map((image, index) => (
                  <div key={index} className="image-thumb">
                    <img src={image} alt="Ожидает отправки" />
                  </div>
                ))}
              </div>
            ) : null}

            <div className="upload-zone file-zone">
              <div>
                <strong>Прикрепить файлы</strong> (PDF, DOCX, до{" "}
                {MAX_DOC_SIZE_MB} MB)
              </div>
              <div className="upload-actions">
                <label className="link-button">
                  Выбрать файлы
                  <input
                    type="file"
                    accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    multiple
                    onChange={(event) => {
                      if (event.target.files?.length) {
                        handleDocFiles(event.target.files);
                        event.target.value = "";
                      }
                    }}
                  />
                </label>
                {pendingDocs.length ? (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setPendingDocs([])}
                  >
                    Очистить файлы
                  </button>
                ) : null}
              </div>
            </div>

            {pendingDocs.length ? (
              <div className="file-list">
                {pendingDocs.map((file, index) => (
                  <div key={index} className="file-chip">
                    {file.name}
                    <button
                      type="button"
                      className="file-remove"
                      onClick={() =>
                        setPendingDocs((prev) =>
                          prev.filter((_, idx) => idx !== index)
                        )
                      }
                      aria-label="Удалить файл"
                      title="Удалить файл"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="composer-row">
              <textarea
                placeholder="Опишите, что нужно (Ctrl/Cmd + Enter для отправки)"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
              />
              <button type="button" onClick={handleSend} disabled={!canSend}>
                {isLoading ? "Отправляю..." : "Отправить"}
              </button>
            </div>

            {error ? <div className="error">{error}</div> : null}
            <div className="footer-note">
              Файлы и скриншоты не сохраняются на сервере, только передаются в
              API.
            </div>
          </div>
        </section>
        </div>
      </div>
    </main>
  );
}
