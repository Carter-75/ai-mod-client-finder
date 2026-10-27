# Fabric Mod Client Detector

Identify Minecraft Fabric client-only mods before migrating a world to a dedicated server. This personal project re-implements the original `find-client-mods.ps1` workflow as a web app: drop in a mods folder and it classifies every `.jar` as CLIENT, SERVER, BOTH, or UNKNOWN.

Classification is data-first. The Modrinth API publishes an explicit `client_side` / `server_side` requirement for each mod, and when that data is decisive the verdict comes straight from it, with no AI involved and no API key needed. Mods Modrinth cannot settle fall back to the original script's approach: web search text classified by OpenAI in two passes.

## Features

- Drag-and-drop or folder-based mod collection (filters to `.jar` files)
- Resumable scan sessions with per-mod persisted state
- Modrinth API lookups for authoritative client/server side requirements
- Bing search scraping over plain HTTP with retry logic (no browser automation, so it runs on serverless hosting)
- Two-pass OpenAI classification (`gpt-4o-mini`) as a fallback that mirrors the reference script
- Honest degradation: with no OpenAI key, or when a source cannot settle a mod, the mod is reported UNKNOWN, never guessed
- Structured, real-time logging grouped by category
- Downloadable client-only and unknown mod lists as TXT or ZIP bundles
- Optional AdSense auto ads that activate when a verified client ID is configured
- Browser-side preference toggle for remembering the OpenAI API key
- Local storage of session ID for resumes

## Prerequisites

- Node.js 18.19 or later
- npm 9+

## Installation

```bash
npm install
```

## Environment Configuration

1. Copy `.env.example` to `.env`:

	```bash
	cp .env.example .env
	```

2. Fill in the values:

	- `OPENAI_API_KEY` - optional. Used for scans started without a visitor-supplied key. Visitors can also enter their own key in the UI. With no key anywhere, scans run on Modrinth data alone.
	- `NEXT_PUBLIC_ADSENSE_CLIENT_ID` - optional; when provided, AdSense auto ads load after hydration.
	- `NEXT_PUBLIC_ADSENSE_TEST_MODE` - optional; leave as `on` in development to avoid serving real ads.
	- `SCAN_DATA_DIR` - optional; overrides where session data is stored (defaults to the project directory locally, and the OS temp directory on Vercel).

`.env` is excluded from version control. Never commit populated environment files or API keys.

## Running in Development

```bash
npm run dev
```

Open http://localhost:3000 in your browser.

## How Scanning Works

1. Upload or drop your Fabric mods directory. Only `.jar` file names are sent to the backend.
2. Optionally enter an OpenAI API key. You can opt in to storing the key in `localStorage` on your device; it is never logged or saved on the server.
3. Start the scan. For each mod the backend:
	- Queries the Modrinth API for the mod and reads its published `client_side` / `server_side` requirements. A decisive combination (required on one side, unsupported on the other, or required on both) settles the verdict directly.
	- Otherwise, if an OpenAI key is available, searches Bing for client/server context, extracts the result page text, and requests a verdict from OpenAI (two passes, same prompt style as the reference script).
	- If neither source can settle the mod, records UNKNOWN for manual review.
	- Saves results incrementally under the session data directory:
		- `storage/sessions/<session-id>/state.json` - verdict by mod
		- `storage/sessions/<session-id>/client_only.txt` - unique client-only mods
		- `storage/sessions/<session-id>/unknown.txt` - mods requiring manual review
		- `storage/sessions/<session-id>/logs.jsonl` - structured log stream
4. Download results as plain text or ZIP bundles containing TXT and JSON summary artifacts.

If the browser closes, returning with the same session ID resumes from the saved state, as long as the server still holds that session's data (see Deployment Notes).

## Project Structure Highlights

- `src/server/` - scanning engine, persistence helpers, structured logging
- `src/app/api/` - Next.js API routes for sessions, streaming events, and downloads
- `src/app/page.tsx` - client experience with Bulma styling, Anime.js progress animation, and Matter.js background scene
- `storage/` - session data when running locally (gitignored)
- `logs/` - structured logs when running locally (gitignored)

## Deployment Notes

- The hosted deployment runs on Vercel. There is no browser automation and no headless browser download; all outbound lookups are plain HTTPS (Modrinth API, Bing search, OpenAI API), which is what makes the scan work in a serverless function at all.
- Vercel's filesystem is read-only outside the temp directory, so session data is stored under the OS temp directory there. Temp storage is ephemeral: sessions survive refreshes and short returns while the instance lives, but are not a permanent archive and can be cleared on redeploy or instance recycle.
- Set `OPENAI_API_KEY` in the project environment if you want keyless visitors to get AI fallback classification. Leaving it unset is fully supported; those scans are Modrinth-only.

## License

You are welcome to use the hosted AI Mod Client Finder website for its intended scanning workflow. The source code and bundled assets remain proprietary and may not be copied, modified, redistributed, or incorporated into other projects without written permission. See LICENSE for details.

## Security and Privacy

- API keys are never logged or written to disk.
- Jar file names are sent to the Modrinth API, and (for the fallback) to Bing search and OpenAI, as described in the privacy policy at `/privacy`.
- Session IDs are validated as UUIDs before any storage path is built from them.
- Rate limiting sleeps (800 ms pass gap, 1.2 s between mods) carry over from the reference implementation.

## What Not to Commit

- Secrets: `.env`, `.openai_key`
- Runtime artifacts: `storage/`, `logs/`, download results
- Node modules: `node_modules/`

Refer to `.gitignore` for the complete exclusion list.
