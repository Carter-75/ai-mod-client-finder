# Fabric Mod Client Detector

Identify Minecraft Fabric client-only mods before migrating a world to a dedicated server. This personal project re-implements the original `find-client-mods.ps1` workflow as a web app: drop in a mods folder and it classifies every `.jar` as CLIENT, SERVER, BOTH, or UNKNOWN.

Classification is data-first. The Modrinth API publishes an explicit `client_side` / `server_side` requirement for each mod, and when that data is decisive the verdict comes straight from it, with no AI involved and no API key needed. Mods Modrinth cannot settle fall back to the original script's approach: web search text classified by OpenAI in two passes.

## Features

- Drag-and-drop or folder-based mod collection (filters to `.jar` files)
- Resumable scans: the mod list and every result persist in the browser (localStorage), so a refresh or a return visit picks up where you left off
- Modrinth API lookups for authoritative client/server side requirements
- Bing search scraping over plain HTTP with retry logic (no browser automation, so it runs on serverless hosting)
- Two-pass OpenAI classification (`gpt-4o-mini`) as a fallback that mirrors the reference script
- Honest degradation: with no OpenAI key, or when a source cannot settle a mod, the mod is reported UNKNOWN, never guessed
- Structured, real-time logging grouped by category
- Downloadable client-only and unknown mod lists as TXT or ZIP bundles, generated in the browser
- Optional AdSense auto ads that activate when a verified client ID is configured
- Browser-side preference toggle for remembering the OpenAI API key
- Stateless server: the single `/api/classify` endpoint classifies one jar per request and stores nothing

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

`.env` is excluded from version control. Never commit populated environment files or API keys.

## Running in Development

```bash
npm run dev
```

Open http://localhost:3000 in your browser.

## How Scanning Works

1. Upload or drop your Fabric mods directory. Only `.jar` file names are sent to the backend, one per request.
2. Optionally enter an OpenAI API key. You can opt in to storing the key in `localStorage` on your device; it is never logged or saved on the server.
3. Start the scan. The browser walks the list and calls `POST /api/classify` once per mod. For each mod the backend:
	- Queries the Modrinth API for the mod and reads its published `client_side` / `server_side` requirements. A decisive combination (required on one side, unsupported on the other, or required on both) settles the verdict directly.
	- Otherwise, if an OpenAI key is available, searches Bing for client/server context, extracts the result page text, and requests a verdict from OpenAI (two passes, same prompt style as the reference script).
	- If neither source can settle the mod, returns UNKNOWN for manual review.
	- Returns the verdict plus the structured log entries produced along the way; the browser stores the result in `localStorage` immediately.
4. Download results as plain text or ZIP bundles containing TXT and JSON summary artifacts, generated in the browser from the stored results.

Closing or refreshing the browser loses nothing: the list and results are in `localStorage`, and starting the scan again skips everything already classified. Clearing browser data or using Reset Workspace deletes them.

Why stateless: an earlier version of this app kept scan sessions on the server (in-memory map plus files under `storage/sessions/`). On Vercel that cannot work: serverless instances share neither memory nor disk, the project filesystem is read-only, and session creation failed live with HTTP 500. Browser-owned state is the design that actually survives serverless hosting, and it is also the more private one: the server stores nothing at all.

## Project Structure Highlights

- `src/server/scanner/classify.ts` - the stateless per-mod classification engine (Modrinth, then search plus AI)
- `src/app/api/classify/` - the single Next.js API route
- `src/app/page.tsx` - client experience with Bulma styling, Anime.js progress animation, and Matter.js background scene; owns the mod list, scan loop, results, persistence, and downloads

## Deployment Notes

- The hosted deployment runs on Vercel. There is no browser automation and no headless browser download; all outbound lookups are plain HTTPS (Modrinth API, Bing search, OpenAI API), which is what makes classification work in a serverless function at all.
- The API is stateless by design (see How Scanning Works), so there is no server-side session storage to persist, back up, or lose.
- Set `OPENAI_API_KEY` in the project environment if you want keyless visitors to get AI fallback classification. Leaving it unset is fully supported; those scans are Modrinth-only.

## License

You are welcome to use the hosted AI Mod Client Finder website for its intended scanning workflow. The source code and bundled assets remain proprietary and may not be copied, modified, redistributed, or incorporated into other projects without written permission. See LICENSE for details.

## Security and Privacy

- API keys are never logged or written to disk; the server stores nothing at all.
- Jar file names are sent to the Modrinth API, and (for the fallback) to Bing search and OpenAI, as described in the privacy policy at `/privacy`.
- The classify endpoint accepts only a single `.jar` file name per request (paths are reduced to base names).
- Rate limiting sleeps (800 ms between AI passes) carry over from the reference implementation, and OpenAI calls are bounded to a 30 second timeout with no retries so a hung connection cannot stall a classification.

## What Not to Commit

- Secrets: `.env`, `.openai_key`
- Node modules: `node_modules/`

Refer to `.gitignore` for the complete exclusion list.
