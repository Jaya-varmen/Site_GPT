"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function AuthPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextPath = searchParams.get("next") || "/";

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Ошибка авторизации");
      }

      router.replace(nextPath);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Ошибка авторизации";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>Вход в Neurocube GPT</h1>
        <p>Введите пароль для доступа к сайту.</p>

        <form onSubmit={handleSubmit} className="auth-form">
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Пароль"
            autoFocus
          />
          <button type="submit" disabled={isSubmitting || !password}>
            {isSubmitting ? "Проверка..." : "Войти"}
          </button>
        </form>

        {error ? <div className="error">{error}</div> : null}
      </div>
    </main>
  );
}

function AuthFallback() {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>Вход в Neurocube GPT</h1>
        <p>Загрузка...</p>
      </div>
    </main>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={<AuthFallback />}>
      <AuthPageContent />
    </Suspense>
  );
}
