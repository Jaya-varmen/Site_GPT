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

type PendingFile = {
  name: string;
  type: string;
  data: string;
  size: number;
};

type Provider = "openai" | "gemini";

type CommonChatMessage = {
  id: string;
  senderId: string;
  text: string;
  createdAt: string;
};

const MAX_IMAGES = 6;
const MAX_FILES = 5;
const MAX_FILE_SIZE_MB = 20;
const COMMON_CHAT_LIMIT = 80;
const SPACE_VALUES = [1, 2, 3, 4] as const;
const PROVIDER_META: Record<Provider, { label: string; model: string }> = {
  openai: { label: "OpenAI", model: "gpt-5.2" },
  gemini: { label: "Gemini", model: "gemini-2.5-flash" }
};

const DOC_FILE_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv"
]);

const DOC_FILE_EXTENSIONS = [".pdf", ".docx", ".xlsx", ".xls", ".csv"];
const COMMON_CHAT_SENDER_KEY = "neurocube-common-chat-sender-id";

function generateId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeTitle(text: string) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Временный чат";
  if (cleaned.length <= 60) return cleaned;
  return `${cleaned.slice(0, 57)}...`;
}

function isSupportedDataFile(file: File) {
  const lowerName = file.name.toLowerCase();
  return (
    DOC_FILE_TYPES.has(file.type) ||
    DOC_FILE_EXTENSIONS.some((extension) => lowerName.endsWith(extension))
  );
}

function getOrCreateCommonChatSenderId() {
  if (typeof window === "undefined") {
    return generateId();
  }

  const existing = window.localStorage.getItem(COMMON_CHAT_SENDER_KEY);
  if (existing) {
    return existing;
  }

  const next = generateId();
  window.localStorage.setItem(COMMON_CHAT_SENDER_KEY, next);
  return next;
}

export default function Home() {
  const [space, setSpace] = useState<1 | 2 | 3 | 4>(1);
  const [provider, setProvider] = useState<Provider>("openai");

  const [dbChats, setDbChats] = useState<ChatSummary[]>([]);
  const [dbCurrentChatId, setDbCurrentChatId] = useState<string | null>(null);
  const [dbMessages, setDbMessages] = useState<Message[]>([]);

  const [tempChats, setTempChats] = useState<ChatSummary[]>([]);
  const [tempCurrentChatId, setTempCurrentChatId] = useState<string | null>(null);
  const [tempMessagesByChatId, setTempMessagesByChatId] = useState<
    Record<string, Message[]>
  >({});

  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingChats, setIsLoadingChats] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [commonChatOpen, setCommonChatOpen] = useState(false);
  const [commonChatMessages, setCommonChatMessages] = useState<CommonChatMessage[]>([]);
  const [commonChatInput, setCommonChatInput] = useState("");
  const [commonChatError, setCommonChatError] = useState<string | null>(null);
  const [isCommonChatLoading, setIsCommonChatLoading] = useState(false);
  const [isCommonChatSending, setIsCommonChatSending] = useState(false);
  const [commonChatSenderId, setCommonChatSenderId] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const commonBottomRef = useRef<HTMLDivElement | null>(null);

  const isTempSpace = space === 4;
  const currentChatId = isTempSpace ? tempCurrentChatId : dbCurrentChatId;
  const chats = isTempSpace ? tempChats : dbChats;

  const messages = useMemo(() => {
    if (!isTempSpace) return dbMessages;
    if (!tempCurrentChatId) return [];
    return tempMessagesByChatId[tempCurrentChatId] || [];
  }, [dbMessages, isTempSpace, tempCurrentChatId, tempMessagesByChatId]);

  const canSend = useMemo(() => {
    return (
      !isLoading &&
      (input.trim().length > 0 || pendingImages.length > 0 || pendingFiles.length > 0)
    );
  }, [isLoading, input, pendingImages.length, pendingFiles.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    setError(null);

    if (space === 4) {
      setIsLoadingChats(false);
      setIsLoadingMessages(false);
      return;
    }

    setDbCurrentChatId(null);
    setDbMessages([]);
    void loadChats(space);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space]);

  useEffect(() => {
    setCommonChatSenderId(getOrCreateCommonChatSenderId());
  }, []);

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

  const handleImageFiles = async (files: FileList | File[]) => {
    setError(null);
    const items = Array.from(files).filter((file) => file.type.startsWith("image/"));

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

  const handleDataFiles = async (files: FileList | File[]) => {
    setError(null);
    const items = Array.from(files).filter(isSupportedDataFile);

    if (items.length === 0) {
      setError("Поддерживаются PDF, DOCX, XLSX, XLS и CSV.");
      return;
    }

    const availableSlots = Math.max(0, MAX_FILES - pendingFiles.length);
    if (availableSlots === 0) {
      setError(`Можно прикрепить до ${MAX_FILES} файлов.`);
      return;
    }

    const selected = items.slice(0, availableSlots);
    if (items.length > availableSlots) {
      setError(`Добавлены только первые ${availableSlots} файлов.`);
    }

    const oversize = selected.find(
      (file) => file.size > MAX_FILE_SIZE_MB * 1024 * 1024
    );
    if (oversize) {
      setError(
        `Файл ${oversize.name} слишком большой. Максимум ${MAX_FILE_SIZE_MB} MB.`
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

    setPendingFiles((prev) => [...prev, ...dataItems]);
  };

  const loadChats = async (targetSpace: 1 | 2 | 3) => {
    setIsLoadingChats(true);
    try {
      const response = await fetch(`/api/chats?space=${targetSpace}`, {
        cache: "no-store"
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Не удалось загрузить чаты.");
      }
      setDbChats(payload.chats || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Неизвестная ошибка.";
      setError(message);
    } finally {
      setIsLoadingChats(false);
    }
  };

  const loadCommonChat = async (silent = false) => {
    if (!silent) {
      setIsCommonChatLoading(true);
    }

    try {
      const response = await fetch(`/api/common-chat?limit=${COMMON_CHAT_LIMIT}`, {
        cache: "no-store"
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Не удалось загрузить общий чат.");
      }
      setCommonChatMessages(payload.messages || []);
      setCommonChatError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Неизвестная ошибка.";
      setCommonChatError(message);
    } finally {
      if (!silent) {
        setIsCommonChatLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!commonChatOpen) return;

    void loadCommonChat();
    const timer = window.setInterval(() => {
      void loadCommonChat(true);
    }, 4000);

    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commonChatOpen]);

  useEffect(() => {
    if (!commonChatOpen) return;
    commonBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [commonChatOpen, commonChatMessages, isCommonChatSending]);

  const openPersistentChat = async (chatId: string) => {
    setIsLoadingMessages(true);
    setDbCurrentChatId(chatId);
    setError(null);
    try {
      const response = await fetch(`/api/chats?id=${chatId}`, {
        cache: "no-store"
      });
      const payload = await response.json();
      if (!response.ok) {
        if (response.status === 404) {
          setDbCurrentChatId(null);
          setDbMessages([]);
          void loadChats(space as 1 | 2 | 3);
        }
        throw new Error(payload?.error || "Не удалось открыть чат.");
      }
      setDbMessages(payload.messages || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Неизвестная ошибка.";
      setError(message);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const openChat = (chatId: string) => {
    if (isTempSpace) {
      setTempCurrentChatId(chatId);
      return;
    }

    void openPersistentChat(chatId);
  };

  const deletePersistentChat = async (chatId: string) => {
    const response = await fetch("/api/chats", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || "Не удалось удалить чат.");
    }

    if (dbCurrentChatId === chatId) {
      setDbCurrentChatId(null);
      setDbMessages([]);
    }

    await loadChats(space as 1 | 2 | 3);
  };

  const deleteTempChat = (chatId: string) => {
    setTempChats((prev) => prev.filter((chat) => chat.id !== chatId));
    setTempMessagesByChatId((prev) => {
      const next = { ...prev };
      delete next[chatId];
      return next;
    });

    if (tempCurrentChatId === chatId) {
      setTempCurrentChatId(null);
    }
  };

  const deleteChat = async (chatId: string) => {
    const confirmed = window.confirm("Удалить чат без возможности восстановления?");
    if (!confirmed) return;

    try {
      if (isTempSpace) {
        deleteTempChat(chatId);
      } else {
        await deletePersistentChat(chatId);
      }
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Неизвестная ошибка.";
      setError(message);
    }
  };

  const createPersistentChat = async () => {
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
    setDbChats((prev) => [chat, ...prev]);
    setDbCurrentChatId(chat.id);
    setDbMessages([]);
    return chat;
  };

  const createTempChat = () => {
    const now = new Date().toISOString();
    const chat: ChatSummary = {
      id: generateId(),
      title: "Временный чат",
      updatedAt: now,
      space: 4
    };

    setTempChats((prev) => [chat, ...prev]);
    setTempCurrentChatId(chat.id);
    setTempMessagesByChatId((prev) => ({ ...prev, [chat.id]: [] }));
    return chat;
  };

  const createChat = async () => {
    if (isTempSpace) {
      return createTempChat();
    }

    return createPersistentChat();
  };

  const ensureChat = async () => {
    if (currentChatId) return currentChatId;
    const chat = await createChat();
    return chat.id;
  };

  const touchTempChat = (chatId: string, userText?: string) => {
    setTempChats((prev) => {
      const now = new Date().toISOString();
      const next = prev.map((chat) => {
        if (chat.id !== chatId) return chat;

        const title =
          userText && chat.title === "Временный чат"
            ? normalizeTitle(userText)
            : chat.title;

        return {
          ...chat,
          title,
          updatedAt: now
        };
      });

      return next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  };

  const appendTempMessage = (chatId: string, message: Message) => {
    setTempMessagesByChatId((prev) => {
      const current = prev[chatId] || [];
      return {
        ...prev,
        [chatId]: [...current, message]
      };
    });
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

    setIsLoading(true);
    setError(null);

    const userText = input.trim();
    const outgoingImages = pendingImages;
    const outgoingFiles = pendingFiles;

    try {
      const activeChatId = await ensureChat();
      const history = isTempSpace
        ? (tempMessagesByChatId[activeChatId] || []).map((message) => ({
            role: message.role,
            text: message.text
          }))
        : undefined;

      const userMessage: Message = {
        id: generateId(),
        role: "user",
        text: userText,
        images: outgoingImages.length ? outgoingImages : undefined,
        files: outgoingFiles.length
          ? outgoingFiles.map((file) => ({ name: file.name, type: file.type }))
          : undefined
      };

      if (isTempSpace) {
        appendTempMessage(activeChatId, userMessage);
        touchTempChat(activeChatId, userText || undefined);
      } else {
        setDbMessages((prev) => [...prev, userMessage]);
      }

      setInput("");
      setPendingImages([]);
      setPendingFiles([]);

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          chatId: isTempSpace ? null : activeChatId,
          ephemeral: isTempSpace,
          history,
          text: userMessage.text,
          images: userMessage.images,
          files: outgoingFiles
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Запрос не выполнен.");
      }

      const assistantMessage: Message = {
        id: payload?.assistantMessage?.id || generateId(),
        role: "assistant",
        text: payload.output || ""
      };

      if (isTempSpace) {
        appendTempMessage(activeChatId, assistantMessage);
        touchTempChat(activeChatId);
      } else {
        setDbMessages((prev) => [...prev, assistantMessage]);
        void loadChats(space as 1 | 2 | 3);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Неизвестная ошибка.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCommonChatSend = async () => {
    if (isCommonChatSending) return;
    const text = commonChatInput.trim();
    if (!text) return;
    if (!commonChatSenderId) {
      setCommonChatError("Не удалось определить отправителя. Перезагрузите страницу.");
      return;
    }

    setIsCommonChatSending(true);
    setCommonChatError(null);

    try {
      const response = await fetch("/api/common-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderId: commonChatSenderId,
          text
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Не удалось отправить сообщение.");
      }
      setCommonChatInput("");
      setCommonChatMessages((prev) => [...prev, payload.message]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Неизвестная ошибка.";
      setCommonChatError(message);
    } finally {
      setIsCommonChatSending(false);
    }
  };

  const handleCommonChatKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void handleCommonChatSend();
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    if (event.dataTransfer.files?.length) {
      await handleImageFiles(event.dataTransfer.files);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void handleSend();
    }
  };

  const isEmptyState = messages.length === 0 && !isLoading;

  return (
    <main>
      <div className="app-shell">
        <header className="header">
          <div className="brand">
            <div className="title">Neurocube GPT</div>
            <div className="subtitle">
              Ваш бесплатный GPT помощник. Раздел 4 работает как временный режим.
            </div>
          </div>

          <div className="header-actions">
            <label className="provider-control" htmlFor="provider-select">
              <span>API</span>
              <select
                id="provider-select"
                value={provider}
                onChange={(event) => setProvider(event.target.value as Provider)}
              >
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
              </select>
            </label>

            <div className="model-pill">
              {PROVIDER_META[provider].label} <span>{PROVIDER_META[provider].model}</span>
            </div>

            <div className="space-switch" aria-label="Выбор раздела чатов">
              {SPACE_VALUES.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`space-button ${space === value ? "active" : ""} ${
                    value === 4 ? "temporary" : ""
                  }`}
                  onClick={() => setSpace(value)}
                  title={
                    value === 4
                      ? "Временный раздел: чаты не сохраняются после перезагрузки"
                      : `Раздел ${value}`
                  }
                  aria-label={
                    value === 4 ? "Раздел 4 (временный)" : `Раздел ${value}`
                  }
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

            <div className="sidebar-subtitle">
              {isTempSpace
                ? "Раздел 4: временные чаты (до перезагрузки страницы)."
                : `Раздел ${space}: чаты сохраняются постоянно.`}
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
                    className={`chat-item ${chat.id === currentChatId ? "active" : ""}`}
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
                      <div className="chat-meta">{formatTimestamp(chat.updatedAt)}</div>
                    </div>
                    <button
                      type="button"
                      className="chat-delete"
                      onClick={(event) => {
                        event.stopPropagation();
                        void deleteChat(chat.id);
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
                    Выберите чат слева или создайте новый. Можно прикреплять скриншоты и
                    документы (PDF, DOCX, XLSX, XLS, CSV). Для отправки используйте
                    Ctrl/Command + Enter.
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
                onDrop={(event) => {
                  void handleDrop(event);
                }}
                style={{
                  borderColor: isDragActive ? "rgba(110, 231, 249, 0.9)" : undefined,
                  background: isDragActive ? "rgba(110, 231, 249, 0.08)" : undefined
                }}
              >
                <div>
                  <strong>Прикрепить скриншоты</strong> (перетащите или выберите)
                </div>

                <div className="upload-actions">
                  <label className="link-button">
                    Выбрать изображения
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(event) => {
                        if (event.target.files?.length) {
                          void handleImageFiles(event.target.files);
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
                <div className="image-grid compact">
                  {pendingImages.map((image, index) => (
                    <div key={index} className="image-thumb">
                      <img src={image} alt="Ожидает отправки" />
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="upload-zone file-zone">
                <div>
                  <strong>Прикрепить файлы</strong> (PDF, DOCX, XLSX, XLS, CSV до{" "}
                  {MAX_FILE_SIZE_MB} MB)
                </div>

                <div className="upload-actions">
                  <label className="link-button">
                    Выбрать файлы
                    <input
                      type="file"
                      accept=".pdf,.docx,.xlsx,.xls,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                      multiple
                      onChange={(event) => {
                        if (event.target.files?.length) {
                          void handleDataFiles(event.target.files);
                          event.target.value = "";
                        }
                      }}
                    />
                  </label>

                  {pendingFiles.length ? (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => setPendingFiles([])}
                    >
                      Очистить файлы
                    </button>
                  ) : null}
                </div>
              </div>

              {pendingFiles.length ? (
                <div className="file-list">
                  {pendingFiles.map((file, index) => (
                    <div key={index} className="file-chip">
                      {file.name}
                      <button
                        type="button"
                        className="file-remove"
                        onClick={() =>
                          setPendingFiles((prev) => prev.filter((_, idx) => idx !== index))
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
                <button type="button" onClick={() => void handleSend()} disabled={!canSend}>
                  {isLoading ? "Отправляю..." : "Отправить"}
                </button>
              </div>

              {error ? <div className="error">{error}</div> : null}

              <div className="footer-note">
                Файлы и скриншоты не сохраняются на сервере. В разделе 4 история чатов не
                сохраняется после перезагрузки страницы.
              </div>
            </div>
          </section>
        </div>
      </div>

      <button
        type="button"
        className={`common-chat-toggle ${commonChatOpen ? "open" : ""}`}
        onClick={() => setCommonChatOpen((prev) => !prev)}
        aria-label={commonChatOpen ? "Скрыть общий чат" : "Открыть общий чат"}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16H9l-4.2 3.4c-.5.4-1.2 0-1.2-.6V5.5zm2.5-.5a.5.5 0 0 0-.5.5v11.2L8.3 15h9.2a.5.5 0 0 0 .5-.5v-8a.5.5 0 0 0-.5-.5h-11z" />
        </svg>
        <span>Общий чат</span>
      </button>

      <aside
        className={`common-chat-panel ${commonChatOpen ? "open" : ""}`}
        aria-hidden={!commonChatOpen}
      >
        <div className="common-chat-header">
          <div>
            <div className="common-chat-title">Общий чат</div>
            <div className="common-chat-subtitle">Сообщения видят все пользователи</div>
          </div>
          <button
            type="button"
            className="common-chat-close"
            onClick={() => setCommonChatOpen(false)}
            aria-label="Закрыть общий чат"
          >
            ×
          </button>
        </div>

        <div className="common-chat-list">
          {isCommonChatLoading ? (
            <div className="common-chat-muted">Загрузка...</div>
          ) : commonChatMessages.length ? (
            commonChatMessages.map((message) => {
              const isOwn = message.senderId === commonChatSenderId;
              return (
                <div
                  key={message.id}
                  className={`common-chat-item ${isOwn ? "own" : ""}`}
                >
                  <div className="common-chat-meta">
                    {isOwn ? "Вы" : "Участник"} · {formatTimestamp(message.createdAt)}
                  </div>
                  <div className="common-chat-text">{message.text}</div>
                </div>
              );
            })
          ) : (
            <div className="common-chat-muted">Пока сообщений нет.</div>
          )}
          <div ref={commonBottomRef} />
        </div>

        <div className="common-chat-form">
          <input
            className="common-chat-input"
            placeholder="Написать сообщение..."
            value={commonChatInput}
            onChange={(event) => setCommonChatInput(event.target.value)}
            onKeyDown={handleCommonChatKeyDown}
            maxLength={1000}
          />
          <button
            type="button"
            className="common-chat-send"
            onClick={() => void handleCommonChatSend()}
            disabled={isCommonChatSending || !commonChatInput.trim()}
          >
            {isCommonChatSending ? "..." : "OK"}
          </button>
          {commonChatError ? (
            <div className="common-chat-error">{commonChatError}</div>
          ) : null}
        </div>
      </aside>
    </main>
  );
}
