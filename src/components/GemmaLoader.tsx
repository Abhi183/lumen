// Small status pill + file picker for loading the Gemma model.
//
// We deliberately keep this dead simple: a single chip in the header
// that shows the current load state and lets the caregiver pick a .task
// model file from disk. The keyboard works without it (static fallback),
// so the user is never blocked.

import { useEffect, useRef, useState } from "react";
import { gemma, type GemmaStatus } from "../llm/gemma";

export function GemmaLoader() {
  const [status, setStatus] = useState<GemmaStatus>(gemma.getStatus());
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => gemma.subscribe(setStatus), []);

  const onClick = () => {
    if (status.kind === "loading") return;
    fileInputRef.current?.click();
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await gemma.loadFromFile(file);
    } catch {
      // status pill already shows the error message
    } finally {
      // Clear the input so picking the same file again retriggers.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className={`gemma-pill gemma-pill--${status.kind}`}
        title={pillTitle(status)}
        disabled={status.kind === "loading"}
      >
        <span className="gemma-pill__dot" aria-hidden="true" />
        <span className="gemma-pill__label">{pillLabel(status)}</span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".task,.bin"
        style={{ display: "none" }}
        onChange={onFileChange}
      />
    </>
  );
}

function pillLabel(status: GemmaStatus): string {
  switch (status.kind) {
    case "idle":
      return "Load Gemma";
    case "loading":
      return status.message;
    case "ready":
      return `Gemma ready · ${formatBytes(status.modelSizeBytes)}`;
    case "error":
      return "Gemma failed — retry";
  }
}

function pillTitle(status: GemmaStatus): string {
  switch (status.kind) {
    case "idle":
      return "Click to pick a Gemma .task model file from disk";
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
