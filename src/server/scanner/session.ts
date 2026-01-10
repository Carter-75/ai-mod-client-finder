import { EventEmitter } from "events";
import { promises as fs } from "fs";
import crypto from "crypto";
import { chromium, Page } from "playwright";
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

async function fileExists(target: string) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function appendUnique(target: string, jar: string) {
  const exists = await fileExists(target);
  if (!exists) {
    await fs.writeFile(target, jar + "\n", "utf8");
    return;
  }
  const content = await fs.readFile(target, "utf8");
  if (!content.includes(jar)) {
    await fs.appendFile(target, jar + "\n", "utf8");
  }
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
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Manifest;
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

  private constructor(id: string, jarNames: string[], manifest?: Manifest) {
    super();
    this.id = id;
    this.jarNames = Array.from(new Set(jarNames.map((name) => name.trim()))).filter(Boolean);
    this.manifest =
      manifest ?? ({ id, createdAt: new Date().toISOString(), jarNames: this.jarNames } satisfies Manifest);
  }

  private async bootstrap() {
    const dir = resolveSessionDir(this.id);
    await fs.mkdir(dir, { recursive: true });
    await this.persistManifest();
    await this.loadState();
    await this.loadResults();
    this.emitStatus(this.status);
    this.emitProgress();
  }

  private async persistManifest() {
    const manifestPath = resolveSessionFile(this.id, "manifest.json");
    await fs.writeFile(manifestPath, JSON.stringify(this.manifest, null, 2), "utf8");
  }

  private async loadState() {
    const statePath = resolveSessionFile(this.id, "state.json");
    if (await fileExists(statePath)) {
      this.state = JSON.parse(await fs.readFile(statePath, "utf8"));
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

  async start(apiKey: string): Promise<"started" | "already-running"> {
    if (!apiKey?.trim()) {
      throw new Error("OPENAI API key is required to start scanning.");
    }
    if (this.runningPromise) {
      this.emitLog("session", "debug", "Scan already in progress; skipping new run request.");
      return "already-running" as const;
    }
    this.status = "running";
    this.emitStatus(this.status);
    this.manifest.lastRunAt = new Date().toISOString();
    await this.persistManifest();

    this.runningPromise = this.execute(apiKey.trim()).catch((error) => {
      this.status = "error";
      this.emitStatus(this.status);
      this.emitLog("session", "error", error.message, {
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
    const openai = new OpenAI({ apiKey });
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
      for (const jar of this.manifest.jarNames) {
        if (this.state[jar]) {
          this.emitLog("state", "debug", "Skipping already classified mod.", { jar, verdict: this.state[jar] });
          continue;
        }

        let verdict: Verdict = "UNKNOWN";
        let collectedText = "";

        const q1 = `${jar.replace(/\.jar$/i, "")} minecraft fabric mod client server`;
        const ok1 = await this.safeGoto(page, q1);
        if (ok1) {
          const text = await this.extractBodyText(page);
          collectedText += text;
        }

        if (collectedText) {
          verdict = await this.askAI(openai, jar, collectedText, 1);
        }

        if (verdict === "UNKNOWN") {
          await this.rateLimitedSleep(800);
          const q2 = `${jar.replace(/\.jar$/i, "")} minecraft fabric github`;
          const ok2 = await this.safeGoto(page, q2);
          if (ok2) {
            const text = await this.extractBodyText(page);
            collectedText += `\n\n${text}`;
            verdict = await this.askAI(openai, jar, collectedText, 2);
          }
        }

        await this.persistVerdict(jar, verdict);
        this.emit("event", { type: "result", payload: { jar, verdict } } satisfies ScanEvent);
        this.emitProgress(jar);

        await this.rateLimitedSleep(1200);
      }
    } finally {
      await browser.close();
    }
  }

  private async safeGoto(page: Page, query: string, retries = 3) {
    const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        this.emitLog("scraping", "info", "Navigating to search page.", { url, attempt });
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        return true;
      } catch (error) {
        this.emitLog("timeout", "warn", "Search navigation attempt failed.", {
          url,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
        if (attempt === retries) {
          this.emitLog("timeout", "error", "All retries exhausted for navigation.", { url });
          return false;
        }
        await this.rateLimitedSleep(1500);
      }
    }
    return false;
  }

  private async extractBodyText(page: Page) {
    try {
      const bodyText = await page.evaluate(() => document.body?.innerText ?? "");
      const normalized = (bodyText || "").toLowerCase();
      this.emitLog("scraping", "debug", "Collected body text.", { length: normalized.length });
      return normalized;
    } catch (error) {
      this.emitLog("scraping", "error", "Failed to collect body text.", {
        error: error instanceof Error ? error.message : String(error),
      });
      return "";
    }
  }

  private async askAI(openai: OpenAI, jar: string, text: string, pass: number) {
    const prompt = `\nYou are classifying how a Minecraft Fabric mod must be installed.\n\nAnswer with ONE WORD ONLY:\nCLIENT, SERVER, BOTH, or UNKNOWN.\n\nCLIENT = cosmetic, HUD, UI, minimap, visual-only, not required on server\nSERVER = server logic, gameplay logic, worldgen\nBOTH = explicitly required on both client and server\nUNKNOWN = insufficient or conflicting info\n\nPASS ${pass}\nMOD: ${jar}\n\nTEXT:\n${text.slice(0, 6000)}\n`;

    this.emitLog("ai", "info", "Requesting AI classification.", { jar, pass, textLength: text.length });
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    });

    const content = res.choices[0]?.message?.content?.trim().toUpperCase() ?? "";
    const verdict = VERDICTS.includes(content as Verdict) ? (content as Verdict) : "UNKNOWN";
    this.emitLog("ai", "debug", "AI responded with verdict.", { jar, pass, verdict, raw: content });
    return verdict;
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
    await fs.writeFile(statePath, JSON.stringify(this.state, null, 2), "utf8");
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
