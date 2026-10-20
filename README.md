# MERIDIAN — Personal AI Assistant

The existing Node MERIDIAN app now includes local Ollama support, public web research with source links, local TXT retrieval, saved conversations/reports, and specialist analysis modes while retaining its Codex CLI chat, debate, interruption, browser speech input, and Fish Audio voice output.

## Start

This project already has a `.env` containing private settings. Keep it; do not replace it with `.env.example`. Add or edit only the settings you need:

```env
PORT=4173
AI_PROVIDER=codex
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=
```

`codex` keeps the existing signed-in Codex CLI provider. Set `AI_PROVIDER=ollama` to use Ollama only. Ollama must already be running and have a model installed; MERIDIAN does not start it or download models. `OLLAMA_MODEL` can select a model by its installed name. With the default Codex provider, Ollama status remains visible in the dashboard.
This phone is currently configured for `qwen3:1.7b` as a balance of response quality and speed. Ollama generation has no fixed answer-token cap and uses an 8,192-token context window. Longer responses can take substantially longer and use more memory; press Stop or Esc to interrupt. `qwen3:0.6b` is installed for faster, lighter replies; `qwen3:4b` is available for stronger analysis at slower speeds.

Start with:

```sh
cd "$HOME/geopolitics-agent"
npm start
```

Open `http://127.0.0.1:4173`. The server binds to `127.0.0.1` only. Press Ctrl+C to stop it.

Node 24 is available in the inspected Termux environment and includes `node:sqlite`; there are no new npm dependencies. The app stores messages, library metadata, chunks, and reports in `data/meridian.sqlite3`; imported authorized TXT files are stored in `data/library/`. These local files are excluded from Git.

## Research and library

Turn on **Research** before submitting a question to use DuckDuckGo Lite. MERIDIAN preserves source URLs, attempts to open accessible HTTPS pages, shows when a page could not be opened, and asks the configured model to cite only sources it received. Search snippets are not full articles or independent verification. Publication dates are only stated if present in retrieved text. Search can fail due to connectivity, provider limits, or publisher restrictions.

Chat now fetches timestamped Yahoo Finance quote snapshots for recognized market assets in Market Analysis and relevant price questions, and searches public web sources for other time-sensitive questions. Quote results are on-demand snapshots, not a streaming feed, and may be delayed. MERIDIAN shows source links, retrieval times, and publication dates only when it can identify them. If web lookup fails, it says so instead of guessing current facts.

Import UTF-8 `.txt` files up to 1 MB in the sidebar. Only import books and materials you are authorized to use. Relevant passages are searched locally and added as untrusted source text to historical analysis. No books are downloaded.

Analysis modes include general analysis, historical book analysis, debate, intelligence assessment, strategic scenario, forecasting, and market analysis. Prices are never represented as live unless retrieved evidence says so.

## Voice and interruption

Browser speech recognition is used when available. Answer audio uses the existing Fish Audio configuration; browser speech synthesis remains the fallback. Chat answers stream incrementally, with periodic keepalives for long-running tunnel requests. This can prevent idle Cloudflare 524 timeouts while Ollama is generating, but cannot override any tunnel or proxy maximum-duration limit. Stop or press Esc to interrupt chat or playback. Aborting a chat request terminates its Codex child process or cancels the Ollama/web request.

## Troubleshooting

- **Codex error:** check the local Codex CLI installation and login. `AI_PROVIDER=codex` is the default.
- **Ollama unavailable/no model:** check `http://127.0.0.1:11434/api/tags`. In Termux, start Ollama with Termux libraries first: `LD_LIBRARY_PATH="$PREFIX/lib:$LD_LIBRARY_PATH" ollama serve`. If Ollama is already running, stop that server with Ctrl+C first, then start it with this command. This avoids a conflicting C++ library path from other Termux tools.
- **Fish Audio unavailable:** check the existing private `.env` settings and network access. Do not paste the key into chat or source files.
- **Address already in use:** stop the other app instance or change `PORT` in `.env`.
