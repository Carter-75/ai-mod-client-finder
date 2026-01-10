"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import anime from "animejs";
import { Bodies, Engine, Render, Runner, World } from "matter-js";

import styles from "./page.module.css";

import type { LogEntry, ScanEvent, SessionStatus, SessionSummary, Verdict } from "@/types/scanning";

const API_KEY_STORAGE_KEY = "modScanner.apiKey";
const SESSION_STORAGE_KEY = "modScanner.sessionId";
const LOG_LIMIT = 250;

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString();
}

function computeProgress(summary: SessionSummary | null) {
  if (!summary || summary.total === 0) return 0;
  return Math.round((summary.processed / summary.total) * 100);
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
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [apiKey, setApiKey] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [rejectedFiles, setRejectedFiles] = useState<string[]>([]);
  const [rememberKey, setRememberKey] = useState<boolean>(false);

  const dropRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const backgroundRef = useRef<HTMLDivElement>(null);
  const preferenceLoadedRef = useRef(false);

  useMatterBackground(backgroundRef);

  const updateLogs = useCallback((nextEntry: LogEntry) => {
    setLogs((prev) => {
      const combined = [...prev, nextEntry];
      return combined.slice(Math.max(combined.length - LOG_LIMIT, 0));
    });
  }, []);

  const consumeFiles = useCallback(
    (files: FileList) => {
      if (sessionId) {
        setStatusMessage("Reset workspace to scan a new list of mods.");
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
    [jarNames, sessionId]
  );

  const createSessionIfNeeded = useCallback(async () => {
    if (sessionId) {
      return sessionId;
    }
    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jarNames }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error ?? "Failed to create scanning session");
    }
    const data = (await response.json()) as { session: SessionSummary };
    setSessionSummary(data.session);
    setSessionId(data.session.id);
    localStorage.setItem(SESSION_STORAGE_KEY, data.session.id);
    return data.session.id;
  }, [jarNames, sessionId]);

  const establishEventStream = useCallback(
    (id: string) => {
      eventSourceRef.current?.close();
      const source = new EventSource(`/api/sessions/${id}/events`);

      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as ScanEvent;
          if (payload.type === "log") {
            updateLogs(payload.payload);
          }
          if (payload.type === "progress") {
            setSessionSummary((prev) => (prev ? { ...prev, ...payload.payload } : prev));
          }
          if (payload.type === "status") {
            setSessionSummary((prev) => (prev ? { ...prev, status: payload.payload } : prev));
          }
          if (payload.type === "result") {
            setSessionSummary((prev) => {
              if (!prev) return prev;
              const nextState = { ...prev.state, [payload.payload.jar]: payload.payload.verdict };
              const nextClient = new Set(prev.clientOnly);
              const nextUnknown = new Set(prev.unknown);
              if (payload.payload.verdict === "CLIENT") {
                nextClient.add(payload.payload.jar);
                nextUnknown.delete(payload.payload.jar);
              }
              if (payload.payload.verdict === "UNKNOWN") {
                nextUnknown.add(payload.payload.jar);
              }
              if (payload.payload.verdict !== "CLIENT") {
                nextClient.delete(payload.payload.jar);
              }
              if (payload.payload.verdict !== "UNKNOWN") {
                nextUnknown.delete(payload.payload.jar);
              }
              return {
                ...prev,
                state: nextState,
                clientOnly: Array.from(nextClient).sort(),
                unknown: Array.from(nextUnknown).sort(),
              };
            });
          }
          if (payload.type === "snapshot") {
            setSessionSummary(payload.payload);
            setJarNames(payload.payload.jarNames);
          }
        } catch (error) {
          console.error("Failed to parse SSE payload", error, event.data);
        }
      };

      source.onerror = (error) => {
        console.warn("Event stream error", error);
      };

      eventSourceRef.current = source;
    },
    [updateLogs]
  );

  useEffect(() => () => {
    eventSourceRef.current?.close();
  }, []);

  const processed = sessionSummary?.processed ?? 0;
  const total = sessionSummary?.total ?? jarNames.length ?? 0;
  const progressPercent = computeProgress(sessionSummary);
  const currentStatus: SessionStatus = sessionSummary?.status ?? "idle";

  useEffect(() => {
    const storedKey = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (storedKey) {
      setApiKey(storedKey);
      setRememberKey(true);
    } else {
      setRememberKey(false);
    }
    preferenceLoadedRef.current = true;
    const storedSessionId = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!storedSessionId) {
      return;
    }
    (async () => {
      try {
        const response = await fetch(`/api/sessions/${storedSessionId}`);
        if (!response.ok) {
          localStorage.removeItem(SESSION_STORAGE_KEY);
          return;
        }
        const data = (await response.json()) as { session: SessionSummary };
        setSessionId(storedSessionId);
        setSessionSummary(data.session);
        setJarNames(data.session.jarNames);
        establishEventStream(storedSessionId);
      } catch (error) {
        console.error("Failed to resume previous session", error);
        localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    })();
  }, [establishEventStream]);

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
      if (sessionId) {
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
  }, [consumeFiles, sessionId]);


  async function startScan() {
    if (jarNames.length === 0) {
      setStatusMessage("Add at least one Fabric mod (.jar) to begin.");
      return;
    }
    if (!apiKey) {
      setStatusMessage("Enter your OpenAI API key to continue.");
      return;
    }
    setStatusMessage(null);
    setIsStarting(true);
    try {
      const sessionIdentifier = await createSessionIfNeeded();
      establishEventStream(sessionIdentifier);
      const response = await fetch(`/api/sessions/${sessionIdentifier}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error ?? "Failed to start scanning session");
      }
      setStatusMessage("Scanning in progress. You can leave this tab open and return later.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error starting scan";
      setStatusMessage(message);
      updateLogs({
        level: "error",
        category: "system",
        message,
        timestamp: new Date().toISOString(),
      });
    } finally {
      setIsStarting(false);
    }
  }

  function clearSession() {
    setSessionId(null);
    setSessionSummary(null);
    setLogs([]);
    setJarNames([]);
    setStatusMessage(null);
    setRejectedFiles([]);
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }

  function removeJar(name: string) {
    if (sessionId) {
      setStatusMessage("Reset workspace to edit the mod list.");
      return;
    }
    setJarNames((prev) => prev.filter((jar) => jar !== name));
    setSessionSummary((prev) => {
      if (!prev) return prev;
      const nextState = { ...prev.state };
      delete nextState[name];
      return {
        ...prev,
        jarNames: prev.jarNames.filter((jar) => jar !== name),
        clientOnly: prev.clientOnly.filter((jar) => jar !== name),
        unknown: prev.unknown.filter((jar) => jar !== name),
        state: nextState,
        total: Math.max(prev.total - 1, 0),
        processed: Object.keys(nextState).length,
      };
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

  const progressLabel = useMemo(() => `${processed} / ${total} classified`, [processed, total]);

  return (
    <div className={styles.page}>
      <section className="section">
        <div className="container">
          <div className={styles.hero}>
            <div>
              <h1 className="title is-2 has-text-white">Fabric Mod Client Detector</h1>
              <p className="subtitle is-5 has-text-grey-light">
                Identify client-only mods before you move your Minecraft world to a dedicated server. Fully resumable,
                AI-assisted, and crash safe.
              </p>
              <div className="buttons mt-4">
                <button className="button is-info is-light" onClick={clearSession} disabled={!sessionId && jarNames.length === 0}>
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
            <li>Drop in your mods folder or select it manually; only <code>.jar</code> names are uploaded to the scan session.</li>
            <li>Provide an OpenAI API key and choose whether to remember it locally on this device.</li>
            <li>Start the scan and let it run; progress autosaves so you can refresh or return later.</li>
            <li>Download client-only and unknown mod lists as TXT or ZIP bundles, then share the client pack with players.</li>
          </ol>

          <div className="columns mt-5">
            <div className="column is-half">
              <div className="box">
                <h2 className="title is-5">1. Collect your mods</h2>
                <div
                  ref={dropRef}
                  className={`${styles.dropZone} ${currentStatus === "running" || sessionId ? styles.readonly : ""}`}
                  onClick={() => {
                    if (sessionId) {
                      setStatusMessage("Reset workspace to begin a fresh scan.");
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
                        {sessionSummary?.state?.[name] && (
                          <span className={`tag mr-2 ${verdictBadge(sessionSummary.state[name])}`}>
                            {sessionSummary.state[name]}
                          </span>
                        )}
                        <button
                          className="delete"
                          onClick={() => removeJar(name)}
                          aria-label={`Remove ${name}`}
                          disabled={Boolean(sessionId)}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
                {jarNames.length === 0 && <p className="has-text-grey is-size-7">No mods added yet.</p>}
              </div>

              <div className="box mt-4">
                <h2 className="title is-5">2. Provide your OpenAI credentials</h2>
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
                    Stored locally only. We never transmit or log your key beyond the classification request.
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
                <button className="button is-primary" onClick={startScan} disabled={isStarting || currentStatus === "running"}>
                  {currentStatus === "running" ? "Scanning..." : "Start scan"}
                </button>
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
                    <dd>{sessionSummary?.clientOnly.length ?? 0}</dd>
                  </div>
                  <div className="is-flex is-justify-content-space-between">
                    <dt>Unknown</dt>
                    <dd>{sessionSummary?.unknown.length ?? 0}</dd>
                  </div>
                </dl>
              </div>

              <div className="box mt-4">
                <h3 className="title is-6">Live log</h3>
                <div className={styles.logPanel}>
                  {logs.map((log) => (
                    <div key={`${log.timestamp}-${log.message}-${log.category}`} className={styles.logLine}>
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
                  {(sessionSummary?.clientOnly ?? []).map((jar) => (
                    <li key={jar}>
                      <span>{jar}</span>
                      <span className="tag is-primary is-light">CLIENT</span>
                    </li>
                  ))}
                </ul>
                <div className={`${styles.downloadActions} mt-3`}>
                  <a
                    className="button is-small is-link"
                    href={sessionId ? `/api/sessions/${sessionId}/download?type=client` : "#"}
                    aria-disabled={!sessionId}
                    tabIndex={!sessionId ? -1 : undefined}
                  >
                    Download TXT
                  </a>
                  <a
                    className="button is-small is-link is-light"
                    href={sessionId ? `/api/sessions/${sessionId}/download?type=client&format=zip` : "#"}
                    aria-disabled={!sessionId}
                    tabIndex={!sessionId ? -1 : undefined}
                  >
                    Download ZIP bundle
                  </a>
                  <button
                    className="button is-small"
                    onClick={() => copyList(sessionSummary?.clientOnly ?? [], "Client-only")}
                    disabled={!sessionSummary?.clientOnly.length}
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
                  {(sessionSummary?.unknown ?? []).map((jar) => (
                    <li key={jar}>
                      <span>{jar}</span>
                      <span className="tag is-dark is-light">UNKNOWN</span>
                    </li>
                  ))}
                </ul>
                <div className={`${styles.downloadActions} mt-3`}>
                  <a
                    className="button is-small is-link is-light"
                    href={sessionId ? `/api/sessions/${sessionId}/download?type=unknown` : "#"}
                    aria-disabled={!sessionId}
                    tabIndex={!sessionId ? -1 : undefined}
                  >
                    Download TXT
                  </a>
                  <a
                    className="button is-small is-dark"
                    href={sessionId ? `/api/sessions/${sessionId}/download?type=unknown&format=zip` : "#"}
                    aria-disabled={!sessionId}
                    tabIndex={!sessionId ? -1 : undefined}
                  >
                    Download ZIP bundle
                  </a>
                  <button
                    className="button is-small"
                    onClick={() => copyList(sessionSummary?.unknown ?? [], "Unknown")}
                    disabled={!sessionSummary?.unknown.length}
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
              <li>Re-run this scanner whenever you add new mods. Progress persists per session.</li>
            </ol>
          </div>
        </div>
      </section>
    </div>
  );
}
