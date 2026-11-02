# MERIDIAN — Personal AI Assistant

The existing Node MERIDIAN app now includes local Ollama support, public web research with source links, local TXT retrieval, saved conversations/reports, Mediastack geopolitical headlines, Aviationstack flight tracking, and specialist analysis modes while retaining its Codex CLI chat, debate, interruption, browser speech input, and Fish Audio voice output.

## Install on Linux, macOS, or Windows

MERIDIAN requires Git and Node.js 24 or newer. Node 24 is the minimum supported runtime because the app uses Node's built-in SQLite module. The project has no npm dependencies to install.

### 1. Install Node.js and Git

- **Windows:** Install the current LTS release from the [official Node.js downloads page](https://nodejs.org/en/download). Install [Git for Windows](https://git-scm.com/download/win) if Git is not already available.
- **macOS:** Install Git with Xcode Command Line Tools (`xcode-select --install`) or Homebrew. Install Node 24 or newer from the [official Node.js downloads page](https://nodejs.org/en/download), or install [nvm](https://github.com/nvm-sh/nvm) using the commands below.
- **Linux:** Install Git with your distribution's package manager. Install Node 24 or newer from the [official Node.js downloads page](https://nodejs.org/en/download), or install [nvm](https://github.com/nvm-sh/nvm) using the commands below.

To install Node 24 with nvm on Linux or macOS, run its installer:

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
```

Open a new terminal so nvm is loaded, then install Node 24:

```sh
nvm install 24
```

Check the installed runtime:

```sh
node --version
```

The version must be `v24` or newer.

### 2. Clone the repository

Run these commands in PowerShell, Terminal, or your Linux shell:

```sh
git clone https://github.com/mafia999011-hue/meridian-personal-assistant.git
cd meridian-personal-assistant
```

### 3. Configure an AI provider

For local AI, install [Ollama](https://ollama.com/download) for your operating system. The official install commands are:

**Windows PowerShell:**

```powershell
irm https://ollama.com/install.ps1 | iex
```

**macOS or Linux Terminal:**

```sh
curl -fsSL https://ollama.com/install.sh | sh
```

On Windows, Ollama runs in the background after installation. On macOS, open the Ollama app. On Linux, start the Ollama service if the installer did not start it. Then download the model used by this setup:

```sh
ollama pull qwen3:1.7b
```

Create your local settings file. **PowerShell:**

```powershell
Copy-Item .env.example .env
notepad .env
```

**Linux or macOS:**

```sh
cp .env.example .env
```

Open `.env` in your preferred text editor and set `AI_PROVIDER=ollama`. Keep API keys private in this file; do not commit `.env`. Add optional Mediastack, Aviationstack, or Fish Audio credentials only if you use those features. Aviationstack and Mediastack require separate provider keys. The API rejects unrecognized hosts and cross-site browser requests and applies per-route request and concurrency limits. MERIDIAN has no built-in sign-in: anyone who can reach its URL can access the dashboard, saved data, and API features. Keep it local or place it behind Cloudflare Access or another access-control proxy before sharing it publicly. For a custom HTTPS hostname, list its exact origin(s), comma-separated, in `MERIDIAN_ALLOWED_ORIGINS`. Never commit `.env` or expose API keys.

You can use `AI_PROVIDER=codex` instead if the Codex CLI is installed and signed in on your machine.

### 4. Start MERIDIAN

From the project directory, run:

```sh
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The server listens on this computer only. Press Ctrl+C in the terminal to stop it. If port 4173 is occupied, set a different `PORT` in `.env` and restart.

The app stores conversations, reports, and library metadata in `data/meridian.sqlite3`; imported TXT files are stored in `data/library/`. Those local files are excluded from Git.

## News and aviation tracking

Set `MEDIASTACK_ACCESS_KEY` in `.env` to load sourced geopolitical headlines on demand. Results are cached locally for 10 minutes; the dashboard does not poll automatically. Mediastack plan limits affect request volume and freshness.

## Aviation tracking

Set a valid Aviationstack-specific `AVIATIONSTACK_ACCESS_KEY` in `.env` to enable the Live Aviation Tracker. Aviationstack and Mediastack issue separate keys; do not reuse one provider's key for the other. Restart MERIDIAN after editing `.env`. It can query active flights, a flight number, departures from an airport, or arrivals to an airport. Flight data is requested on demand to avoid unnecessary API usage; provider timestamps, positions, and filtering depend on your Aviationstack plan. The key remains server-side.

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
