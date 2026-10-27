import OpenAI from "openai";

import { sleep } from "@/server/utils/sleep";
import type { LogEntry, Verdict } from "@/types/scanning";
import { createLogEntry } from "@/server/log-entry";

export type LogFn = (entry: LogEntry) => void;

const VERDICTS: Verdict[] = ["CLIENT", "SERVER", "BOTH", "UNKNOWN"];
const LOADER_WORDS = new Set(["fabric", "forge", "quilt", "neoforge", "minecraft", "mod"]);
const SEARCH_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const MODRINTH_USER_AGENT = "Carter-75/ai-mod-client-finder (portfolio project)";

function cleanModName(jar: string) {
  const base = jar.replace(/\.jar$/i, "");
  return base
    .split(/[-_+ ]+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .filter((token) => {
      // Drop version-like tokens: 0.5.8, 1.20.4, mc1.20, v2, build123
      if (/^v?\d+(\.\d+)*([.+_-].*)?$/.test(token)) return false;
      if (/^mc\d/.test(token)) return false;
      if (/^build\d+$/.test(token)) return false;
      return true;
    });
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

interface ModrinthHit {
  slug?: string;
  title?: string;
}

interface ModrinthProject {
  client_side?: string;
  server_side?: string;
  project_type?: string;
}

export interface ClassifyOutcome {
  verdict: Verdict;
  // True when OpenAI rejected the key (401/403): the caller should stop
  // sending it for the rest of the run.
  keyRejected: boolean;
  // True when any usable OpenAI key was available for this classification.
  aiAvailable: boolean;
}

function verdictFromSides(
  log: LogFn,
  jar: string,
  slug: string,
  project: ModrinthProject
): Verdict | null {
  const client = project.client_side ?? "unknown";
  const server = project.server_side ?? "unknown";

  let verdict: Verdict | null = null;
  if (client === "required" && server === "unsupported") verdict = "CLIENT";
  else if (server === "required" && client === "unsupported") verdict = "SERVER";
  else if (client === "required" && server === "required") verdict = "BOTH";

  if (verdict) {
    log(createLogEntry("info", "scraping", "Modrinth side data is decisive.", {
      jar,
      slug,
      client_side: client,
      server_side: server,
      verdict,
    }));
    return verdict;
  }

  log(createLogEntry("debug", "scraping", "Modrinth side data is not decisive; falling back.", {
    jar,
    slug,
    client_side: client,
    server_side: server,
  }));
  return null;
}

async function fetchModrinthProject(slug: string): Promise<ModrinthProject | null> {
  const response = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(slug)}`, {
    headers: { "User-Agent": MODRINTH_USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    return null;
  }
  const project = (await response.json()) as ModrinthProject;
  return project.project_type === "mod" ? project : null;
}

async function askModrinth(log: LogFn, jar: string): Promise<Verdict | null> {
  const tokens = cleanModName(jar);
  if (tokens.length === 0) {
    return null;
  }
  const coreTokens = tokens.filter((token) => !LOADER_WORDS.has(token));
  try {
    log(createLogEntry("info", "scraping", "Looking up mod on Modrinth.", { jar, query: tokens.join(" ") }));

    // Step 1: direct slug lookups. Jar names usually embed the project
    // slug, with or without loader words: "sodium-fabric-0.5.8.jar" maps
    // to slug "sodium", "fabric-api-0.92.0.jar" maps to "fabric-api".
    const slugCandidates = Array.from(
      new Set([tokens.join("-"), coreTokens.join("-")].filter((slug) => slug.length > 0))
    );
    for (const slug of slugCandidates) {
      const project = await fetchModrinthProject(slug);
      if (project) {
        // A matched project with non-decisive sides ends the Modrinth
        // pass; searching further would only find a different mod.
        return verdictFromSides(log, jar, slug, project);
      }
    }

    // Step 2: search, with and without loader words. Loader words in the
    // query skew Modrinth ranking toward addons, so both are tried.
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
        log(createLogEntry("warn", "scraping", "Modrinth search failed.", { jar, query, status: searchResponse.status }));
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
        const project = await fetchModrinthProject(matched.slug);
        if (project) {
          return verdictFromSides(log, jar, matched.slug, project);
        }
      }
    }

    log(createLogEntry("debug", "scraping", "No confident Modrinth match.", { jar }));
    return null;
  } catch (error) {
    log(createLogEntry("warn", "scraping", "Modrinth lookup errored; falling back.", {
      jar,
      error: error instanceof Error ? error.message : String(error),
    }));
    return null;
  }
}

async function fetchSearchText(log: LogFn, query: string, retries = 2): Promise<string> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10`;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      log(createLogEntry("info", "scraping", "Fetching search results page.", { url, attempt }));
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
      log(createLogEntry("debug", "scraping", "Collected search text.", { length: text.length }));
      return text;
    } catch (error) {
      log(createLogEntry("warn", "timeout", "Search fetch attempt failed.", {
        url,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      }));
      if (attempt === retries) {
        log(createLogEntry("error", "timeout", "All retries exhausted for search fetch.", { url }));
        return "";
      }
      await sleep(1500);
    }
  }
  return "";
}

async function askAI(
  log: LogFn,
  openai: OpenAI,
  jar: string,
  text: string,
  pass: number
): Promise<{ verdict: Verdict; keyRejected: boolean }> {
  const prompt = `\nYou are classifying how a Minecraft Fabric mod must be installed.\n\nAnswer with ONE WORD ONLY:\nCLIENT, SERVER, BOTH, or UNKNOWN.\n\nCLIENT = cosmetic, HUD, UI, minimap, visual-only, not required on server\nSERVER = server logic, gameplay logic, worldgen\nBOTH = explicitly required on both client and server\nUNKNOWN = insufficient or conflicting info\n\nPASS ${pass}\nMOD: ${jar}\n\nTEXT:\n${text.slice(0, 6000)}\n`;

  log(createLogEntry("info", "ai", "Requesting AI classification.", { jar, pass, textLength: text.length }));
  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    });
    const content = res.choices[0]?.message?.content?.trim().toUpperCase() ?? "";
    const verdict = VERDICTS.includes(content as Verdict) ? (content as Verdict) : "UNKNOWN";
    log(createLogEntry("debug", "ai", "AI responded with verdict.", { jar, pass, verdict, raw: content }));
    return { verdict, keyRejected: false };
  } catch (error) {
    const status = (error as { status?: number })?.status;
    if (status === 401 || status === 403) {
      log(createLogEntry("error", "ai", "OpenAI rejected the API key. AI classification is disabled for the rest of this scan; affected mods will be marked UNKNOWN.", { jar, pass, status }));
      return { verdict: "UNKNOWN", keyRejected: true };
    }
    log(createLogEntry("warn", "ai", "AI classification request failed; treating this pass as UNKNOWN.", {
      jar,
      pass,
      error: error instanceof Error ? error.message : String(error),
    }));
    return { verdict: "UNKNOWN", keyRejected: false };
  }
}

/**
 * Classify a single jar. Stateless: the caller owns progress and results.
 *
 * Order: Modrinth structured side data (no key, decisive when
 * required/unsupported or required/required), then the two-pass Bing plus
 * OpenAI fallback when a key is available, then honest UNKNOWN.
 */
export async function classifyJar(log: LogFn, jar: string, apiKey: string): Promise<ClassifyOutcome> {
  const modrinthVerdict = await askModrinth(log, jar);
  if (modrinthVerdict) {
    return { verdict: modrinthVerdict, keyRejected: false, aiAvailable: Boolean(apiKey) };
  }

  if (!apiKey) {
    log(createLogEntry("warn", "ai", "No OpenAI API key available and Modrinth could not settle this mod; marking UNKNOWN.", { jar }));
    return { verdict: "UNKNOWN", keyRejected: false, aiAvailable: false };
  }

  // Bound every OpenAI call: the SDK default timeout is 10 minutes with
  // retries, which would stall classification on a hung connection.
  const openai = new OpenAI({ apiKey, timeout: 30_000, maxRetries: 0 });
  const cleanName = cleanModName(jar).join(" ");
  let collectedText = "";
  let verdict: Verdict = "UNKNOWN";

  const text1 = await fetchSearchText(log, `${cleanName} minecraft fabric mod client server`);
  if (text1) {
    collectedText += text1;
    const pass1 = await askAI(log, openai, jar, collectedText, 1);
    verdict = pass1.verdict;
    if (pass1.keyRejected) {
      return { verdict, keyRejected: true, aiAvailable: true };
    }
  }

  if (verdict === "UNKNOWN") {
    await sleep(800);
    const text2 = await fetchSearchText(log, `${cleanName} minecraft fabric github`);
    if (text2) {
      collectedText += `\n\n${text2}`;
      if (collectedText) {
        const pass2 = await askAI(log, openai, jar, collectedText, 2);
        verdict = pass2.verdict;
        if (pass2.keyRejected) {
          return { verdict, keyRejected: true, aiAvailable: true };
        }
      }
    }
  }

  return { verdict, keyRejected: false, aiAvailable: true };
}
