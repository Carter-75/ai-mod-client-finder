"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import anime from "animejs";
import JSZip from "jszip";
import { Bodies, Engine, Render, Runner, World } from "matter-js";

import styles from "./page.module.css";

import type { ClassifyResponse, LogEntry, Verdict } from "@/types/scanning";

const API_KEY_STORAGE_KEY = "modScanner.apiKey";
const JARS_STORAGE_KEY = "modScanner.jars";
const RESULTS_STORAGE_KEY = "modScanner.results";
const LOG_LIMIT = 250;

type ScanStatus = "idle" | "running" | "paused" | "completed";

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString();
}

function verdictBadge(verdict: Verdict) {
  const mapping: Record<Verdict, string> = {
    CLIENT: "is-primary",
    SERVER: "is-info",
    BOTH: "is-warning",
    UNKNOWN: "is-dark",
  };
  return mapping[verdict];
}

function useMatterBackground(containerRef: RefObject<HTMLDivElement>) {
  useEffect(() => {
    if (!containerRef.current) return undefined;

    const width = containerRef.current.clientWidth;
    const height = 320;

    const engine = Engine.create();
    const render = Render.create({
      element: containerRef.current,
      engine,
      options: {
        width,
        height,
        wireframes: false,
        background: "transparent",
      },
    });

    const floor = Bodies.rectangle(width / 2, height + 25, width, 50, {
      isStatic: true,
    });

    const bubbles = Array.from({ length: 8 }).map((_, index) =>
      Bodies.circle(60 + index * (width / 8), 50 + index * 5, 18 + index * 2, {
        restitution: 0.9,
        render: { fillStyle: index % 2 === 0 ? "#00c2ff" : "#ddf3ff" },
      })
    );

    World.add(engine.world, [floor, ...bubbles]);

    const runner = Runner.create();
    Runner.run(runner, engine);
    Render.run(render);

    const resizeHandler = () => {
      const nextWidth = containerRef.current?.clientWidth ?? width;
      render.canvas.width = nextWidth;
      render.options.width = nextWidth;
    };

    window.addEventListener("resize", resizeHandler);

    return () => {
      window.removeEventListener("resize", resizeHandler);
      Render.stop(render);
      Runner.stop(runner);
      World.clear(engine.world, false);
      Engine.clear(engine);
      render.canvas.remove();
    };
  }, [containerRef]);
}

export default function Home() {
  const [jarNames, setJarNames] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, Verdict>>({});
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [apiKey, setApiKey] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [rejectedFiles, setRejectedFiles] = useState<string[]>([]);
  const [rememberKey, setRememberKey] = useState<boolean>(false);

  const dropRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const backgroundRef = useRef<HTMLDivElement>(null);
  const preferenceLoadedRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const keyRejectedRef = useRef(false);

  useMatterBackground(backgroundRef);

  const clientOnly = useMemo(
    () => jarNames.filter((jar) => results[jar] === "CLIENT"),
    [jarNames, results]
  );
  const unknown = useMemo(
    () => jarNames.filter((jar) => results[jar] === "UNKNOWN"),
    [jarNames, results]
  );
  const processed = useMemo(
    () => jarNames.filter((jar) => results[jar]).length,
    [jarNames, results]
  );
  const total = jarNames.length;
  const progressPercent = total === 0 ? 0 : Math.round((processed / total) * 100);
  const currentStatus: ScanStatus = isScanning
    ? "running"
    : total > 0 && processed === total
      ? "completed"
      : processed > 0
        ? "paused"
        : "idle";

  const appendLogs = useCallback((entries: LogEntry[]) => {
    if (entries.length === 0) return;
    setLogs((prev) => {
      const combined = [...prev, ...entries];
      return combined.slice(Math.max(combined.length - LOG_LIMIT, 0));
    });
  }, []);

  const consumeFiles = useCallback(
    (files: FileList) => {
      if (isScanning) {
        setStatusMessage("Stop the current scan to change the mod list.");
        return;
      }
      const next = new Set(jarNames);
      const rejected: string[] = [];
      Array.from(files).forEach((file) => {
        if (file.name.toLowerCase().endsWith(".jar")) {
          next.add(file.name);
        } else {
          rejected.push(file.name);
        }
      });
      setJarNames(Array.from(next).sort());
      setRejectedFiles(rejected);
    },
    [jarNames, isScanning]
  );

  // Load persisted workspace (mod list, results, remembered key) once.
  useEffect(() => {
    const storedKey = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (storedKey) {
      setApiKey(storedKey);
      setRememberKey(true);
    } else {
      setRememberKey(false);
    }
    try {
      const storedJars = JSON.parse(localStorage.getItem(JARS_STORAGE_KEY) ?? "[]") as string[];
      const storedResults = JSON.parse(localStorage.getItem(RESULTS_STORAGE_KEY) ?? "{}") as Record<string, Verdict>;
      if (Array.isArray(storedJars)) {
        setJarNames(storedJars.filter((jar) => typeof jar === "string"));
      }
      if (storedResults && typeof storedResults === "object") {
        setResults(storedResults);
      }
    } catch {
      localStorage.removeItem(JARS_STORAGE_KEY);
      localStorage.removeItem(RESULTS_STORAGE_KEY);
    }
    preferenceLoadedRef.current = true;
  }, []);

  useEffect(() => {
    if (!preferenceLoadedRef.current) return;
    localStorage.setItem(JARS_STORAGE_KEY, JSON.stringify(jarNames));
  }, [jarNames]);

  useEffect(() => {
    if (!preferenceLoadedRef.current) return;
    localStorage.setItem(RESULTS_STORAGE_KEY, JSON.stringify(results));
  }, [results]);

  useEffect(() => {
    if (!preferenceLoadedRef.current) {
      return;
    }
    if (rememberKey && apiKey) {
      localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
    } else {
      localStorage.removeItem(API_KEY_STORAGE_KEY);
    }
  }, [rememberKey, apiKey]);

  useEffect(() => {
    if (!progressRef.current) return;
    anime({
      targets: progressRef.current,
      width: `${progressPercent}%`,
      easing: "easeOutQuad",
      duration: 500,
    });
  }, [progressPercent]);

  useEffect(() => {
    const preventDefault = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const dropZone = dropRef.current;
    if (!dropZone) return;

    const handleDrop = (event: DragEvent) => {
      preventDefault(event);
      if (isScanning) {
        return;
      }
      const files = event.dataTransfer?.files;
      if (files) {
        consumeFiles(files);
      }
    };

    document.addEventListener("dragover", preventDefault);
    document.addEventListener("drop", preventDefault);
    dropZone.addEventListener("drop", handleDrop);

    return () => {
      document.removeEventListener("dragover", preventDefault);
      document.removeEventListener("drop", preventDefault);
      dropZone.removeEventListener("drop", handleDrop);
    };
  }, [consumeFiles, isScanning]);

  async function startScan() {
    if (jarNames.length === 0) {
      setStatusMessage("Add at least one Fabric mod (.jar) to begin.");
      return;
    }
    const pending = jarNames.filter((jar) => !results[jar]);
    if (pending.length === 0) {
      setStatusMessage("Every mod in the list is already classified. Reset the workspace to start over.");
      return;
    }
    setStatusMessage(null);
    stopRequestedRef.current = false;
    keyRejectedRef.current = false;
    setIsScanning(true);
    let keyWasRejected = false;
    try {
      for (const jar of pending) {
        if (stopRequestedRef.current) {
          setStatusMessage("Scan stopped. Classified results are saved in this browser; start again any time to continue.");
          break;
        }
        let data: ClassifyResponse;
        try {
          const response = await fetch("/api/classify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jar, apiKey: keyWasRejected ? "" : apiKey || undefined }),
          });
          if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error ?? `Classification request failed (HTTP ${response.status})`);
          }
          data = (await response.json()) as ClassifyResponse;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unexpected error during classification";
          appendLogs([
            {
              level: "error",
              category: "system",
              message: `Could not classify ${jar}: ${message}. Marked UNKNOWN; you can reset and retry.`,
              timestamp: new Date().toISOString(),
            },
          ]);
          setResults((prev) => ({ ...prev, [jar]: "UNKNOWN" }));
          continue;
        }
        appendLogs(data.logs);
        if (data.keyRejected) {
          keyWasRejected = true;
          keyRejectedRef.current = true;
        }
        setResults((prev) => ({ ...prev, [jar]: data.verdict }));
      }
      if (!stopRequestedRef.current) {
        setStatusMessage(
          keyRejectedRef.current
            ? "Scan finished. OpenAI rejected the API key, so mods Modrinth could not settle are marked Unknown."
            : apiKey
              ? "Scan finished. Results are saved in this browser."
              : "Scan finished using Modrinth data. Mods Modrinth could not settle are marked Unknown, because no OpenAI key was provided. Results are saved in this browser."
        );
      }
    } finally {
      setIsScanning(false);
    }
  }

  function stopScan() {
    stopRequestedRef.current = true;
  }

  function clearWorkspace() {
    stopRequestedRef.current = true;
    setResults({});
    setLogs([]);
    setJarNames([]);
    setStatusMessage(null);
    setRejectedFiles([]);
    localStorage.removeItem(JARS_STORAGE_KEY);
    localStorage.removeItem(RESULTS_STORAGE_KEY);
  }

  function removeJar(name: string) {
    if (isScanning) {
      setStatusMessage("Stop the current scan to edit the mod list.");
      return;
    }
    setJarNames((prev) => prev.filter((jar) => jar !== name));
    setResults((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }

  async function copyList(list: string[], label: string) {
    if (!list.length) {
      return;
    }
    try {
      await navigator.clipboard.writeText(list.join("\n"));
      setStatusMessage(`${label} list copied to clipboard.`);
    } catch (error) {
      console.warn("Clipboard copy failed", error);
      setStatusMessage(`Unable to copy ${label.toLowerCase()} list.`);
    }
  }

  async function downloadList(type: "client" | "unknown", format: "txt" | "zip") {
    const entries = (type === "client" ? clientOnly : unknown).slice().sort();
    const body = entries.length > 0 ? entries.join("\n") + "\n" : "No entries classified yet.\n";
    let blob: Blob;
    let filename: string;
    if (format === "zip") {
      const zip = new JSZip();
      zip.file(`${type}-mods.txt`, body);
      zip.file(
        `${type}-mods.json`,
        JSON.stringify(
          { generatedAt: new Date().toISOString(), category: type, entries },
          null,
          2
        )
      );
      blob = await zip.generateAsync({ type: "blob" });
      filename = `${type}-mods.zip`;
    } else {
      blob = new Blob([body], { type: "text/plain; charset=utf-8" });
      filename = `${type}-mods.txt`;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const progressLabel = `${processed} / ${total} classified`;

  return (
    <div className={styles.page}>
      <section className="section">
        <div className="container">
          <div className={styles.hero}>
            <div>
              <h1 className="title is-2 has-text-white">Fabric Mod Client Detector</h1>
              <p className="subtitle is-5 has-text-grey-light">
                Identify client-only mods before you move your Minecraft world to a dedicated server. Classified
                from Modrinth data first, with an optional AI fallback, and your results saved in this browser.
              </p>
              <div className="buttons mt-4">
                <button className="button is-info is-light" onClick={clearWorkspace} disabled={jarNames.length === 0}>
                  Reset Workspace
                </button>
                <a className="button is-link is-light" href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
                  Get an OpenAI API Key
                </a>
              </div>
            </div>
            <div className={styles.background} ref={backgroundRef} aria-hidden />
          </div>

          <ol className={styles.howTo} aria-label="How to use the Fabric Mod Client Detector">
            <li>Drop in your mods folder or select it manually; only <code>.jar</code> file names are sent for classification, never the files themselves.</li>
            <li>Optionally add an OpenAI API key for the mods Modrinth cannot settle from its published side data. Without a key, those mods are marked Unknown instead of guessed.</li>
            <li>Start the scan. Each mod is classified one request at a time, and progress autosaves in this browser so you can refresh or return later.</li>
            <li>Download client-only and unknown mod lists as TXT or ZIP bundles, then share the client pack with players.</li>
          </ol>

          <div className="columns mt-5">
            <div className="column is-half">
              <div className="box">
                <h2 className="title is-5">1. Collect your mods</h2>
                <div
                  ref={dropRef}
                  className={`${styles.dropZone} ${isScanning ? styles.readonly : ""}`}
                  onClick={() => {
                    if (isScanning) {
                      setStatusMessage("Stop the current scan to change the mod list.");
                      return;
                    }
                    const input = document.createElement("input");
                    input.type = "file";
                    input.multiple = true;
                    input.accept = ".jar";
                    input.setAttribute("webkitdirectory", "");
                    input.setAttribute("directory", "");
                    input.onchange = () => {
                      if (input.files) {
                        consumeFiles(input.files);
                      }
                    };
                    input.click();
                  }}
                >
                  <p className="has-text-weight-semibold">Drag & drop your mods folder or click to browse</p>
                  <p className="is-size-7 mt-2 has-text-grey">Only .jar files are processed. Existing progress stays intact.</p>
                </div>
                {rejectedFiles.length > 0 && (
                  <article className="message is-warning mt-3">
                    <div className="message-body">
                      Ignored non-jar files:
                      <ul>
                        {rejectedFiles.map((file) => (
                          <li key={file}>{file}</li>
                        ))}
                      </ul>
                    </div>
                  </article>
                )}
                <ul className={`mt-4 ${styles.jarList}`}>
                  {jarNames.map((name) => (
                    <li key={name} className="is-flex is-justify-content-space-between is-align-items-center">
                      <span>{name}</span>
                      <div>
                        {results[name] && (
                          <span className={`tag mr-2 ${verdictBadge(results[name])}`}>
                            {results[name]}
                          </span>
                        )}
                        <button
                          className="delete"
                          onClick={() => removeJar(name)}
                          aria-label={`Remove ${name}`}
                          disabled={isScanning}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
                {jarNames.length === 0 && <p className="has-text-grey is-size-7">No mods added yet.</p>}
              </div>

              <div className="box mt-4">
                <h2 className="title is-5">2. OpenAI API key (optional)</h2>
                <div className="field">
                  <label className="label">OpenAI API key</label>
                  <div className="control">
                    <input
                      className="input"
                      type="password"
                      placeholder="sk-..."
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value.trim())}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                  <p className="help">
                    Most mods are settled from Modrinth data with no key at all. If you provide a key, it is
                    sent to this server with each classification request and forwarded to OpenAI only for the
                    fallback classification requests. It is never logged or saved on the server. Leaving this
                    blank uses the server-configured key when one is set.
                  </p>
                  <div className={styles.toggleRow}>
                    <label className="checkbox" htmlFor="remember-key-toggle">
                      <input
                        id="remember-key-toggle"
                        type="checkbox"
                        checked={rememberKey}
                        onChange={(event) => {
                          setRememberKey(event.target.checked);
                          if (!event.target.checked) {
                            setStatusMessage("Local API key storage disabled and cleared.");
                          } else {
                            setStatusMessage("Local API key storage enabled.");
                          }
                        }}
                      />
                      <span className="ml-2">Remember this key on this device</span>
                    </label>
                    <button
                      type="button"
                      className="button is-small is-text"
                      onClick={() => {
                        setApiKey("");
                        if (!rememberKey) {
                          localStorage.removeItem(API_KEY_STORAGE_KEY);
                        }
                      }}
                    >
                      Clear field
                    </button>
                  </div>
                </div>
                <div className="buttons">
                  <button className="button is-primary" onClick={startScan} disabled={isScanning}>
                    {isScanning ? "Scanning..." : processed > 0 && processed < total ? "Resume scan" : "Start scan"}
                  </button>
                  {isScanning && (
                    <button className="button is-light" onClick={stopScan}>
                      Stop scan
                    </button>
                  )}
                </div>
                {statusMessage && <p className="mt-3 has-text-info">{statusMessage}</p>}
              </div>
            </div>

            <div className="column is-half">
              <div className="box">
                <h2 className="title is-5">3. Track progress</h2>
                <div className={styles.progressShell}>
                  <div ref={progressRef} className={styles.progressBar} />
                </div>
                <div className="is-flex is-justify-content-space-between is-align-items-center mt-2">
                  <span className="has-text-weight-semibold">{progressLabel}</span>
                  <span className="tag is-light">{progressPercent}%</span>
                </div>
                <dl className="mt-4">
                  <div className="is-flex is-justify-content-space-between">
                    <dt>Status</dt>
                    <dd className={`tag ${styles.statusTag}`}>{currentStatus}</dd>
                  </div>
                  <div className="is-flex is-justify-content-space-between">
                    <dt>Client-only</dt>
                    <dd>{clientOnly.length}</dd>
                  </div>
                  <div className="is-flex is-justify-content-space-between">
                    <dt>Unknown</dt>
                    <dd>{unknown.length}</dd>
                  </div>
                </dl>
              </div>

              <div className="box mt-4">
                <h3 className="title is-6">Live log</h3>
                <div className={styles.logPanel}>
                  {logs.map((log, index) => (
                    <div key={`${log.timestamp}-${index}`} className={styles.logLine}>
                      <span className="tag is-light mr-2">{log.category}</span>
                      <span className={styles.logMessage}>{log.message}</span>
                      <span className={styles.logTime}>{formatTimestamp(log.timestamp)}</span>
                    </div>
                  ))}
                  {logs.length === 0 && <p className="has-text-grey is-size-7">Logs will appear here as the scan runs.</p>}
                </div>
              </div>
            </div>
          </div>

          <div className="columns mt-5">
            <div className="column">
              <div className="box">
                <h3 className="title is-5">Client-only mods</h3>
                <p className="is-size-7 has-text-grey">Keep these on your personal client. Do not upload to the server.</p>
                <ul className={styles.resultList}>
                  {clientOnly.map((jar) => (
                    <li key={jar}>
                      <span>{jar}</span>
                      <span className="tag is-primary is-light">CLIENT</span>
                    </li>
                  ))}
                </ul>
                <div className={`${styles.downloadActions} mt-3`}>
                  <button className="button is-small is-link" onClick={() => downloadList("client", "txt")}>
                    Download TXT
                  </button>
                  <button className="button is-small is-link is-light" onClick={() => downloadList("client", "zip")}>
                    Download ZIP bundle
                  </button>
                  <button
                    className="button is-small"
                    onClick={() => copyList(clientOnly, "Client-only")}
                    disabled={!clientOnly.length}
                  >
                    Copy to clipboard
                  </button>
                </div>
              </div>
            </div>
            <div className="column">
              <div className="box">
                <h3 className="title is-5">Unknown mods</h3>
                <p className="is-size-7 has-text-grey">Review these manually. Install on server only when you confirm requirements.</p>
                <ul className={styles.resultList}>
                  {unknown.map((jar) => (
                    <li key={jar}>
                      <span>{jar}</span>
                      <span className="tag is-dark is-light">UNKNOWN</span>
                    </li>
                  ))}
                </ul>
                <div className={`${styles.downloadActions} mt-3`}>
                  <button className="button is-small is-link is-light" onClick={() => downloadList("unknown", "txt")}>
                    Download TXT
                  </button>
                  <button className="button is-small is-dark" onClick={() => downloadList("unknown", "zip")}>
                    Download ZIP bundle
                  </button>
                  <button
                    className="button is-small"
                    onClick={() => copyList(unknown, "Unknown")}
                    disabled={!unknown.length}
                  >
                    Copy to clipboard
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="box mt-5">
            <h3 className="title is-5">Next steps</h3>
            <ol className={styles.nextSteps}>
              <li>Upload only non-client mods to your new server instance.</li>
              <li>Distribute the client-only pack to players joining the server.</li>
              <li>Re-run this scanner whenever you add new mods. Your list and results stay saved in this browser until you reset the workspace.</li>
            </ol>
          </div>
        </div>
      </section>
    </div>
  );
}
