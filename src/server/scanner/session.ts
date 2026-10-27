import { EventEmitter } from "events";
import { promises as fs } from "fs";
import crypto from "crypto";
import OpenAI from "openai";

import { resolveSessionDir, resolveSessionFile } from "@/server/config";
import { createLogEntry, writeSessionLog } from "@/server/logger";
import { sleep } from "@/server/utils/sleep";
import type {
  LogEntry,
  ProgressSnapshot,
  ScanEvent,
  SessionStatus,
  SessionSummary,
  Verdict,
} from "@/types/scanning";

export interface Manifest {
  id: string;
  createdAt: string;
  jarNames: string[];
  lastRunAt?: string;
}

const VERDICTS: Verdict[] = ["CLIENT", "SERVER", "BOTH", "UNKNOWN"];
const LOADER_WORDS = new Set(["fabric", "forge", "quilt", "neoforge", "minecraft", "mod"]);
const SEARCH_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const MODRINTH_USER_AGENT = "Carter-75/ai-mod-client-finder (portfolio project)";

async function fileExists(target: string) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

// Persistence is best effort: on serverless hosting the disk can be
// read-only or wiped between instances, and a failed write must never
// crash a scan. In-memory state is authoritative while the process lives.
async function safeWrite(target: string, contents: string) {
  try {
    await fs.writeFile(target, contents, "utf8");
  } catch (error) {
    console.warn("Unable to persist file", target, error);
  }
}

async function appendUnique(target: string, jar: string) {
  try {
    const exists = await fileExists(target);
    if (!exists) {
      await fs.writeFile(target, jar + "\n", "utf8");
      return;
    }
    const content = await fs.readFile(target, "utf8");
    const lines = content.split(/\r?\n/);
    if (!lines.includes(jar)) {
      await fs.appendFile(target, jar + "\n", "utf8");
    }
  } catch (error) {
    console.warn("Unable to append to file", target, error);
  }
}

function cleanModName(jar: string) {
  const base = jar.replace(/\.jar$/i, "");
  const tokens = base
    .split(/[-_+ ]+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .filter((token) => {
      // Drop version-like tokens: 0.5.8, 1.20.4, mc1.20, v2, build123, 20240101
      if (/^v?\d+(\.\d+)*([.+_-].*)?$/.test(token)) return false;
      if (/^mc\d/.test(token)) return false;
      if (/^build\d+$/.test(token)) return false;
      return true;
    });
  return tokens;
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

interface ModrinthHit {
  slug?: string;
  title?: string;
  project_id?: string;
}

interface ModrinthProject {
  slug?: string;
  title?: string;
  client_side?: string;
  server_side?: string;
}

export class ScanSession extends EventEmitter {
  static async initialize(jarNames: string[]): Promise<ScanSession> {
    const id = crypto.randomUUID();
    const session = new ScanSession(id, jarNames);
    await session.bootstrap();
    return session;
  }

  static async load(id: string): Promise<ScanSession | undefined> {
    const manifestPath = resolveSessionFile(id, "manifest.json");
    if (!(await fileExists(manifestPath))) {
      return undefined;
    }
    let manifest: Manifest;
    try {
      manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Manifest;
    } catch {
      return undefined;
    }
    const session = new ScanSession(id, manifest.jarNames, manifest);
    await session.bootstrap();
    return session;
  }

  readonly id: string;
  readonly jarNames: string[];
  private manifest: Manifest;
  private state: Record<string, Verdict> = {};
  private status: SessionStatus = "idle";
  private runningPromise: Promise<void> | null = null;
  private clientResults = new Set<string>();
  private unknownResults = new Set<string>();
  private aiDisabledReason: string | null = null;

  private constructor(id: string, jarNames: string[], manifest?: Manifest) {
    super();
    this.id = id;
    this.jarNames = Array.from(new Set(jarNames.map((name) => name.trim()))).filter(Boolean);
    this.manifest =
      manifest ?? ({ id, createdAt: new Date().toISOString(), jarNames: this.jarNames } satisfies Manifest);
  }

  private async bootstrap() {
    const dir = resolveSessionDir(this.id);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      console.warn("Unable to create session directory", dir, error);
    }
    await this.persistManifest();
    await this.loadState();
    await this.loadResults();
    // Status is not persisted, so derive it on load: a session whose mods
    // are all classified is completed, not idle.
    if (
      this.manifest.jarNames.length > 0 &&
      Object.keys(this.state).length >= this.manifest.jarNames.length &&
      this.status === "idle"
    ) {
      this.status = "completed";
    }
    this.emitStatus(this.status);
    this.emitProgress();
  }

  private async persistManifest() {
    const manifestPath = resolveSessionFile(this.id, "manifest.json");
    await safeWrite(manifestPath, JSON.stringify(this.manifest, null, 2));
  }

  private async loadState() {
    const statePath = resolveSessionFile(this.id, "state.json");
    if (await fileExists(statePath)) {
      try {
        this.state = JSON.parse(await fs.readFile(statePath, "utf8"));
      } catch {
        this.state = {};
      }
    }
  }

  private async loadResults() {
    const clientPath = resolveSessionFile(this.id, "client_only.txt");
    if (await fileExists(clientPath)) {
      const entries = (await fs.readFile(clientPath, "utf8")).split(/\r?\n/).filter(Boolean);
      entries.forEach((entry) => this.clientResults.add(entry));
    }
    const unknownPath = resolveSessionFile(this.id, "unknown.txt");
    if (await fileExists(unknownPath)) {
      const entries = (await fs.readFile(unknownPath, "utf8")).split(/\r?\n/).filter(Boolean);
      entries.forEach((entry) => this.unknownResults.add(entry));
    }
  }

  getSummary(): SessionSummary {
    return {
      id: this.id,
      jarNames: this.manifest.jarNames,
      processed: Object.keys(this.state).length,
      total: this.manifest.jarNames.length,
      status: this.status,
      clientOnly: Array.from(this.clientResults),
      unknown: Array.from(this.unknownResults),
      state: { ...this.state },
    };
  }

  async getResults() {
    return {
      clientOnly: Array.from(this.clientResults),
      unknown: Array.from(this.unknownResults),
      state: { ...this.state },
    };
  }

  async start(apiKey?: string): Promise<"started" | "already-running"> {
    const providedKey = apiKey?.trim();
    // The key is optional: a visitor-supplied key wins, then the
    // server-configured OPENAI_API_KEY. With neither, the scan still runs
    // on Modrinth data alone and anything Modrinth cannot settle is
    // honestly reported as UNKNOWN instead of being guessed by an AI.
    const effectiveKey = providedKey || process.env.OPENAI_API_KEY?.trim() || "";
    if (this.runningPromise) {
      this.emitLog("session", "debug", "Scan already in progress; skipping new run request.");
      return "already-running" as const;
    }
    this.aiDisabledReason = effectiveKey ? null : "no OpenAI API key was provided";
    this.status = "running";
    this.emitStatus(this.status);
    this.manifest.lastRunAt = new Date().toISOString();
    await this.persistManifest();

    this.runningPromise = this.execute(effectiveKey).catch((error) => {
      this.status = "error";
      this.emitStatus(this.status);
      this.emitLog("session", "error", error instanceof Error ? error.message : String(error), {
        stack: error instanceof Error ? error.stack : undefined,
      });
    }).finally(() => {
      this.runningPromise = null;
      if (this.status !== "error") {
        this.status = Object.keys(this.state).length === this.manifest.jarNames.length ? "completed" : "idle";
        this.emitStatus(this.status);
      }
    });

    return "started" as const;
  }

  private async execute(apiKey: string) {
    // Bound every OpenAI call: the SDK default timeout is 10 minutes with
    // retries, which would stall a scan on a hung connection.
    const openai = apiKey ? new OpenAI({ apiKey, timeout: 30_000, maxRetries: 0 }) : null;
    if (!openai) {
      this.emitLog(
        "ai",
        "warn",
        "No OpenAI API key available. Modrinth data will be used alone; mods it cannot settle will be marked UNKNOWN."
      );
    }

    for (const jar of this.manifest.jarNames) {
      if (this.state[jar]) {
        this.emitLog("state", "debug", "Skipping already classified mod.", { jar, verdict: this.state[jar] });
        continue;
      }

      let verdict: Verdict = "UNKNOWN";
      try {
        verdict = await this.classifyJar(openai, jar);
      } catch (error) {
        this.emitLog("system", "error", "Classification failed for mod; marking UNKNOWN.", {
          jar,
          error: error instanceof Error ? error.message : String(error),
        });
        verdict = "UNKNOWN";
      }

      await this.persistVerdict(jar, verdict);
      this.emit("event", { type: "result", payload: { jar, verdict } } satisfies ScanEvent);
      this.emitProgress(jar);

      await this.rateLimitedSleep(1200);
    }
  }

  private async classifyJar(openai: OpenAI | null, jar: string): Promise<Verdict> {
    // Pass 0: Modrinth structured data. The Modrinth API publishes an
    // explicit client_side / server_side requirement for every mod, which
    // is authoritative when it is decisive. No API key is needed.
    const modrinthVerdict = await this.askModrinth(jar);
    if (modrinthVerdict) {
      return modrinthVerdict;
    }

    // Fallback: web search text classified by OpenAI, the two-pass flow
    // from the original script. Without a working key this honestly
    // degrades to UNKNOWN.
    if (!openai || this.aiDisabledReason) {
      if (openai && this.aiDisabledReason) {
        this.emitLog("ai", "debug", "Skipping AI classification; AI is disabled for this run.", {
          jar,
          reason: this.aiDisabledReason,
        });
      }
      return "UNKNOWN";
    }

    const cleanName = cleanModName(jar).join(" ");
    let collectedText = "";
    let verdict: Verdict = "UNKNOWN";

    const text1 = await this.fetchSearchText(`${cleanName} minecraft fabric mod client server`);
    if (text1) {
      collectedText += text1;
      verdict = await this.askAI(openai, jar, collectedText, 1);
    }

    if (verdict === "UNKNOWN") {
      await this.rateLimitedSleep(800);
      const text2 = await this.fetchSearchText(`${cleanName} minecraft fabric github`);
      if (text2) {
        collectedText += `\n\n${text2}`;
        if (collectedText) {
          verdict = await this.askAI(openai, jar, collectedText, 2);
        }
      }
    }

    return verdict;
  }

  private verdictFromSides(jar: string, slug: string, project: ModrinthProject): Verdict | null {
    const client = project.client_side ?? "unknown";
    const server = project.server_side ?? "unknown";

    let verdict: Verdict | null = null;
    if (client === "required" && server === "unsupported") verdict = "CLIENT";
    else if (server === "required" && client === "unsupported") verdict = "SERVER";
    else if (client === "required" && server === "required") verdict = "BOTH";

    if (verdict) {
      this.emitLog("scraping", "info", "Modrinth side data is decisive.", {
        jar,
        slug,
        client_side: client,
        server_side: server,
        verdict,
      });
      return verdict;
    }

    this.emitLog("scraping", "debug", "Modrinth side data is not decisive; falling back.", {
      jar,
      slug,
      client_side: client,
      server_side: server,
    });
    return null;
  }

  private async fetchModrinthProject(slug: string): Promise<ModrinthProject | null> {
    const response = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(slug)}`, {
      headers: { "User-Agent": MODRINTH_USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      return null;
    }
    const project = (await response.json()) as ModrinthProject & { project_type?: string };
    return project.project_type === "mod" ? project : null;
  }

  private async askModrinth(jar: string): Promise<Verdict | null> {
    const tokens = cleanModName(jar);
    if (tokens.length === 0) {
      return null;
    }
    const coreTokens = tokens.filter((token) => !LOADER_WORDS.has(token));
    try {
      this.emitLog("scraping", "info", "Looking up mod on Modrinth.", { jar, query: tokens.join(" ") });

      // Step 1: direct slug lookups. Jar names usually embed the project
      // slug, with or without loader words: "sodium-fabric-0.5.8.jar" maps
      // to slug "sodium", "fabric-api-0.92.0.jar" maps to "fabric-api".
      const slugCandidates = Array.from(
        new Set([tokens.join("-"), coreTokens.join("-")].filter((slug) => slug.length > 0))
      );
      for (const slug of slugCandidates) {
        const project = await this.fetchModrinthProject(slug);
        if (project) {
          const verdict = this.verdictFromSides(jar, slug, project);
          if (verdict) return verdict;
          // A matched project with non-decisive sides ends the Modrinth
          // pass; searching further would only find a different mod.
          return null;
        }
      }

      // Step 2: search, with and without loader words. Loader words in
      // the query skew Modrinth ranking toward addons, so both are tried.
      const queries = Array.from(
        new Set([tokens.join(" "), coreTokens.join(" ")].filter((query) => query.length > 0))
      );
      const facets = encodeURIComponent(JSON.stringify([["project_type:mod"]]));
      const nameTokens = new Set(tokens);

      for (const query of queries) {
        const searchUrl = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&facets=${facets}&limit=10`;
        const searchResponse = await fetch(searchUrl, {
          headers: { "User-Agent": MODRINTH_USER_AGENT, Accept: "application/json" },
          signal: AbortSignal.timeout(20_000),
        });
        if (!searchResponse.ok) {
          this.emitLog("scraping", "warn", "Modrinth search failed.", { jar, query, status: searchResponse.status });
          continue;
        }
        const searchData = (await searchResponse.json()) as { hits?: ModrinthHit[] };
        const hits = searchData.hits ?? [];

        const matched = hits.find((hit) => {
          const candidates = [hit.slug, hit.title].filter(Boolean).map((value) => normalizeKey(value as string));
          return candidates.some((candidate) => {
            if (!candidate) return false;
            const candidateTokens = candidate.split(" ").filter(Boolean);
            if (candidateTokens.join(" ") === tokens.join(" ")) return true;
            // Accept when the hit name is the mod name minus loader words,
            // for example jar "sodium-fabric" versus Modrinth slug "sodium".
            const remainder = candidateTokens.filter((token) => !nameTokens.has(token));
            const extra = tokens.filter((token) => !candidateTokens.includes(token));
            return (
              remainder.length === 0 &&
              extra.every((token) => LOADER_WORDS.has(token)) &&
              candidateTokens.length >= 1
            );
          });
        });

        if (matched?.slug) {
          const project = await this.fetchModrinthProject(matched.slug);
          if (project) {
            return this.verdictFromSides(jar, matched.slug, project);
          }
        }
      }

      this.emitLog("scraping", "debug", "No confident Modrinth match.", { jar });
      return null;
    } catch (error) {
      this.emitLog("scraping", "warn", "Modrinth lookup errored; falling back.", {
        jar,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async fetchSearchText(query: string, retries = 2): Promise<string> {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10`;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        this.emitLog("scraping", "info", "Fetching search results page.", { url, attempt });
        const response = await fetch(url, {
          headers: { "User-Agent": SEARCH_USER_AGENT, Accept: "text/html" },
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) {
          throw new Error(`Search request returned HTTP ${response.status}`);
        }
        const html = await response.text();
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/gi, " ")
          .replace(/&amp;/gi, "&")
          .replace(/&lt;/gi, "<")
          .replace(/&gt;/gi, ">")
          .replace(/&quot;/gi, '"')
          .replace(/&#39;/gi, "'")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        this.emitLog("scraping", "debug", "Collected search text.", { length: text.length });
        return text;
      } catch (error) {
        this.emitLog("timeout", "warn", "Search fetch attempt failed.", {
          url,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
        if (attempt === retries) {
          this.emitLog("timeout", "error", "All retries exhausted for search fetch.", { url });
          return "";
        }
        await this.rateLimitedSleep(1500);
      }
    }
    return "";
  }

  private async askAI(openai: OpenAI, jar: string, text: string, pass: number) {
    const prompt = `\nYou are classifying how a Minecraft Fabric mod must be installed.\n\nAnswer with ONE WORD ONLY:\nCLIENT, SERVER, BOTH, or UNKNOWN.\n\nCLIENT = cosmetic, HUD, UI, minimap, visual-only, not required on server\nSERVER = server logic, gameplay logic, worldgen\nBOTH = explicitly required on both client and server\nUNKNOWN = insufficient or conflicting info\n\nPASS ${pass}\nMOD: ${jar}\n\nTEXT:\n${text.slice(0, 6000)}\n`;

    this.emitLog("ai", "info", "Requesting AI classification.", { jar, pass, textLength: text.length });
    try {
      const res = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      });
      const content = res.choices[0]?.message?.content?.trim().toUpperCase() ?? "";
      const verdict = VERDICTS.includes(content as Verdict) ? (content as Verdict) : "UNKNOWN";
      this.emitLog("ai", "debug", "AI responded with verdict.", { jar, pass, verdict, raw: content });
      return verdict;
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (status === 401 || status === 403) {
        // A rejected key will fail for every remaining mod. Disable AI for
        // the rest of the run, say so once, and let Modrinth data and
        // UNKNOWN verdicts carry the scan to completion.
        this.aiDisabledReason = "the OpenAI API key was rejected by OpenAI";
        this.emitLog("ai", "error", "OpenAI rejected the API key. AI classification is disabled for the rest of this scan; affected mods will be marked UNKNOWN.", { jar, pass, status });
      } else {
        this.emitLog("ai", "warn", "AI classification request failed; treating this pass as UNKNOWN.", {
          jar,
          pass,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return "UNKNOWN" as Verdict;
    }
  }

  private async persistVerdict(jar: string, verdict: Verdict) {
    this.state[jar] = verdict;
    await this.persistState();

    if (verdict === "CLIENT") {
      this.clientResults.add(jar);
      await appendUnique(resolveSessionFile(this.id, "client_only.txt"), jar);
    }
    if (verdict === "UNKNOWN") {
      this.unknownResults.add(jar);
      await appendUnique(resolveSessionFile(this.id, "unknown.txt"), jar);
    }

    this.emitLog("state", "info", "Persisted verdict.", { jar, verdict });
  }

  private async persistState() {
    const statePath = resolveSessionFile(this.id, "state.json");
    await safeWrite(statePath, JSON.stringify(this.state, null, 2));
  }

  private async rateLimitedSleep(ms: number) {
    this.emitLog("rate-limit", "debug", "Sleeping to respect pacing.", { milliseconds: ms });
    await sleep(ms);
  }

  private emitLog(category: LogEntry["category"], level: LogEntry["level"], message: string, details?: Record<string, unknown>) {
    const entry = createLogEntry(level, category, message, details);
    void writeSessionLog(this.id, entry).catch((error) => {
      console.warn("Unable to persist log entry", error);
    });
    this.emit("event", { type: "log", payload: entry } satisfies ScanEvent);
  }

  private emitStatus(status: SessionStatus) {
    this.emit("event", { type: "status", payload: status } satisfies ScanEvent);
  }

  private emitProgress(lastJar?: string) {
    const snapshot: ProgressSnapshot = {
      processed: Object.keys(this.state).length,
      total: this.manifest.jarNames.length,
      status: this.status,
      lastJar,
    };
    this.emit("event", { type: "progress", payload: snapshot } satisfies ScanEvent);
  }
}
