# Fabric Mod Client Detector

Identify Minecraft Fabric client-only mods before migrating a world to a dedicated server. This app re-implements the original `find-client-mods.ps1` workflow with a modern, resumable web interface, full Playwright scraping, and OpenAI-backed classification.

## Features

- Drag-and-drop or folder-based mod collection (filters to `.jar` files)
- Resumable scan sessions with on-disk persistence per mod
- DuckDuckGo scraping through Playwright Chromium with retry logic
- Two-pass OpenAI classification (`gpt-4o-mini`) that mirrors the reference script
- Structured, real-time logging grouped by category
- Downloadable client-only and unknown mod lists as TXT or ZIP bundles
- Optional AdSense auto ads that activate when a verified client ID is configured
- Browser-side preference toggle for remembering the OpenAI API key
- Local storage of session ID for seamless resumes

## Prerequisites

- Node.js 18.19 or later (Playwright requires recent LTS)
- npm 9+

## Installation

```bash
npm install
```

The `postinstall` hook installs the Chromium build used by Playwright. If the install is interrupted, run `npx playwright install chromium` manually.

## Environment Configuration

1. Copy `.env.example` to `.env`:

	```bash
	cp .env.example .env
	```

2. Fill in the values:

	- `OPENAI_API_KEY` – required at runtime; can also be entered in the UI and stored locally.
	- `NEXT_PUBLIC_ADSENSE_CLIENT_ID` – optional; when provided, AdSense auto ads load after hydration.
	- `NEXT_PUBLIC_ADSENSE_TEST_MODE` – optional; leave as `on` in development to avoid serving real ads.

`.env` is excluded from version control. Never commit populated environment files or API keys.

## Running in Development

```bash
npm run dev
```

Open http://localhost:3000 in your browser.

## How Scanning Works

1. Upload or drop your Fabric mods directory. Only `.jar` file names are sent to the backend.
2. Enter your OpenAI API key. You can opt in to storing the key in `localStorage` on your device; it is never logged.
3. Start the scan. The backend performs the following for each mod:
	- Searches DuckDuckGo for client/server context.
	- Extracts page text via Playwright and lowercases it.
	- Requests a verdict from OpenAI (two passes, identical prompt to the reference script).
	- Saves results incrementally to `storage/sessions/<session-id>/`:
	  - `state.json` – verdict by mod
	  - `client_only.txt` – unique client-only mods
	  - `unknown.txt` – mods requiring manual review
	  - `logs.jsonl` – structured log stream
4. Download results as plain text or ZIP bundles containing TXT and JSON summary artifacts.

If the server or browser crashes, reconnecting will automatically resume the session from the saved state.

## Project Structure Highlights

- `src/server/` – scanning engine, persistence helpers, structured logging
- `src/app/api/` – Next.js API routes for sessions, streaming events, and downloads
- `src/app/page.tsx` – client experience with Bulma styling, Anime.js progress animation, and Matter.js background scene
- `storage/` – session data (gitignored)
- `logs/` – structured logs (gitignored)

## Deployment Notes

- Ensure the host has sufficient permissions to download Playwright browsers.
- Set the `OPENAI_API_KEY` environment variable on the server or rely on per-session user input.
- Persist the `storage/` directory between deployments to maintain resumability.

## License

You are welcome to use the hosted AI Mod Client Finder website for its intended scanning workflow. The source code and bundled assets remain proprietary and may not be copied, modified, redistributed, or incorporated into other projects without written permission. See LICENSE for details.

## Security & Privacy

- API keys are never logged or written to disk.
- All outbound HTTP requests follow the original script: DuckDuckGo search only.
- Rate limiting sleeps (800 ms pass gap, 1.2 s between mods) comply with the reference implementation.

## What Not to Commit

- Secrets: `.env`, `.openai_key`
- Runtime artifacts: `storage/`, `logs/`, Playwright caches, download results
- Node modules: `node_modules/`

Refer to `.gitignore` for the complete exclusion list.
