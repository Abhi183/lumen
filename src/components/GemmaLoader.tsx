// Gemma loader pill plus a drop-down panel for two load paths:
//   1. Pick a local .task file (same as before; fast, no network).
//   2. Download a hosted Gemma model from a URL, with a progress bar so
//      the user can see it isn't frozen on a ~900 MB download.
//
// The old version forced users to find a .task file themselves, which is
// a non-starter for anyone who isn't already technical. This version
// keeps that path but adds a one-click URL option so the app is actually
// usable by caregivers and first-time visitors.
//
// The exact hosted URL is a placeholder. Point it at a HuggingFace or
// Google-hosted Gemma build you've verified for browser use (look for
// the .task file, not the SafeTensors). Leaving as a config so the rest
// of the UI can stay generic.

import { useEffect, useRef, useState } from "react";
import { gemma, type GemmaStatus } from "../llm/gemma";

// Replace with a real .task URL once you have one hosted. The model
// needs to be WebGPU / LlmInference compatible (Gemma 3 nano, .task
// format). Until then, the button prompts the caregiver for a URL.
const DEFAULT_GEMMA_URL = "";

export function GemmaLoader() {
  const [status, setStatus] = useState<GemmaStatus>(gemma.getStatus());
  const [open, setOpen] = useState(false);
  const [downloadPct, setDownloadPct] = useState<number | null>(null);
  const [urlInput, setUrlInput] = useState(DEFAULT_GEMMA_URL);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => gemma.subscribe(setStatus), []);

  // Close the panel on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDocClick);
    return () => window.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const onPillClick = () => {
    if (status.kind === "loading") return;
    setOpen((prev) => !prev);
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await gemma.loadFromFile(file);
      setOpen(false);
    } catch {
      // status pill already shows the error message
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onDownloadClick = async () => {
    const url = urlInput.trim();
    if (!url) return;
    setDownloadPct(0);
    try {
      await gemma.loadFromUrl(url, (pct) => setDownloadPct(pct));
      setOpen(false);
    } catch {
      // status pill shows the error
    } finally {
      setDownloadPct(null);
    }
  };

  return (
    <div className="gemma" ref={panelRef}>
      <button
        type="button"
        onClick={onPillClick}
        className={`gemma-pill gemma-pill--${status.kind}`}
        title={pillTitle(status)}
        disabled={status.kind === "loading"}
        aria-expanded={open}
      >
        <span className="gemma-pill__dot" aria-hidden="true" />
        <span className="gemma-pill__label">{pillLabel(status)}</span>
      </button>

      {open && status.kind !== "loading" && (
        <div className="gemma-panel" role="dialog">
          <div className="gemma-panel__title">AI word suggestions</div>
          <p className="gemma-panel__body">
            Lumen works without this. Suggestions come from a built-in word list when Gemma
            isn't loaded. Adding Gemma makes suggestions smarter, at the cost of a one-time
            ~900 MB download (cached after first load).
          </p>

          <label className="gemma-panel__field">
            <span>Download from URL</span>
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://.../gemma-3-nano.task"
            />
          </label>
          <button
            type="button"
            className="btn btn--primary btn--small"
            onClick={onDownloadClick}
            disabled={urlInput.trim().length === 0 || downloadPct !== null}
          >
            {downloadPct !== null ? `Downloading ${downloadPct}%…` : "Download"}
          </button>

          <div className="gemma-panel__divider"><span>or</span></div>

          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => fileInputRef.current?.click()}
          >
            Pick a local .task file
          </button>

          {status.kind === "error" && (
            <p className="gemma-panel__error">{status.message}</p>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".task,.bin"
        style={{ display: "none" }}
        onChange={onFileChange}
      />
    </div>
  );
}

function pillLabel(status: GemmaStatus): string {
  switch (status.kind) {
    case "idle":
      return "AI · off";
    case "loading":
      return status.message;
    case "ready":
      return `AI · ready (${formatBytes(status.modelSizeBytes)})`;
    case "error":
      return "AI · failed";
  }
}

function pillTitle(status: GemmaStatus): string {
  switch (status.kind) {
    case "idle":
      return "Enable Gemma-powered word suggestions";
    case "loading":
      return "Loading Gemma…";
    case "ready":
      return "Gemma is loaded and ready";
    case "error":
      return status.message;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
