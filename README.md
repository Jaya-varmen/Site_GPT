# Neurocube GPT Chat

Minimal ChatGPT-style UI with screenshot/document upload, OpenAI/Gemini provider switch, and local chat history.

## Setup

1. Copy `.env.local.example` to `.env.local`.
2. Set `OPENAI_API_KEY` for OpenAI and `GEMINI_API_KEY` for Gemini.
3. Optional: set `APP_PASSWORD` (default is `33405`).
4. Install dependencies: `npm install`.
5. Run locally: `npm run dev`.

## Production

- Build: `npm run build`
- Start: `npm run start`

This app is ready for deployment on any Node.js hosting platform that supports Next.js.
