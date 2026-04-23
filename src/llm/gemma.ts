// Lazy on-device Gemma loader.
//
// Loading a multi-hundred-megabyte model is a one-time, user-triggered
// action — we never want it to happen automatically on first paint, and
// we never want it to block the keyboard from being usable. The keyboard
// works fine with the static fallback predictor while Gemma is loading,
// and continues to work if Gemma fails to load entirely.
//
// API:
//   gemma.subscribe(listener)        — observe load state changes
//   gemma.loadFromFile(file)         — load a user-picked .task file
//   gemma.loadFromUrl(url)           — load a hosted .task file
//   gemma.complete(prompt, opts)     — single completion
//   gemma.completeMany(prompt, n)    — k diverse completions
//   gemma.cancel()                   — abort in-flight generation

import {
  FilesetResolver,
  LlmInference,
  type LlmInferenceOptions,
} from "@mediapipe/tasks-genai";

const GENAI_WASM_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai/wasm";

export type GemmaStatus =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "ready"; modelSizeBytes: number; loadedAt: number }
  | { kind: "error"; message: string };

export interface CompleteOptions {
  /** Hard cap on output tokens. Lower = faster, less complete. */
  maxOutputTokens?: number;
  /** Sampling temperature. 0 = greedy, 1 = creative. */
  temperature?: number;
  /** Top-K sampling. */
  topK?: number;
  /** Streaming partial-result callback. */
  onPartial?: (chunk: string, done: boolean) => void;
}

type Listener = (status: GemmaStatus) => void;

class GemmaService {
  private status: GemmaStatus = { kind: "idle" };
  private listeners = new Set<Listener>();
  private llm: LlmInference | null = null;
  private inFlight = false;

  getStatus(): GemmaStatus {
    return this.status;
  }

  isReady(): boolean {
    return this.status.kind === "ready";
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    // Push current state immediately so subscribers don't see a flash.
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async loadFromFile(file: File): Promise<void> {
    this.setStatus({ kind: "loading", message: `Reading ${file.name}…` });
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      await this.loadFromBuffer(buffer, file.size);
    } catch (err) {
      this.setStatus({ kind: "error", message: errorMessage(err) });
      throw err;
    }
  }

  async loadFromUrl(url: string, onProgress?: (pct: number) => void): Promise<void> {
    this.setStatus({ kind: "loading", message: "Downloading model…" });
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Model fetch failed: HTTP ${response.status}`);
      }
      const total = Number(response.headers.get("Content-Length") ?? 0);
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
          if (total > 0 && onProgress) {
            onProgress(Math.round((received / total) * 100));
          } else if (onProgress) {
            // Unknown content length: emit a moving indicator capped at 99.
            onProgress(Math.min(99, Math.round(received / (1024 * 1024))));
          }
        }
      } else {
        // Fallback if streaming isn't available (very old browsers).
        const buf = await response.arrayBuffer();
        chunks.push(new Uint8Array(buf));
        received = buf.byteLength;
        onProgress?.(100);
      }

      const full = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        full.set(chunk, offset);
        offset += chunk.byteLength;
      }
      await this.loadFromBuffer(full, received);
    } catch (err) {
      this.setStatus({ kind: "error", message: errorMessage(err) });
      throw err;
    }
  }

  /**
   * Run a single completion. Returns the model's response text, optionally
   * streaming partial chunks via opts.onPartial.
   */
  async complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
    if (!this.llm) {
      throw new Error("Gemma is not loaded");
    }
    if (this.inFlight) {
      // Only one generation can be in flight at a time on the LlmInference
      // task. Cancel the previous one to make room for the new one.
      this.cancel();
    }
    this.inFlight = true;
    try {
      const wrapped = wrapPrompt(prompt);
      if (opts.onPartial) {
        const text = await this.llm.generateResponse(wrapped, (chunk, done) => {
          opts.onPartial?.(chunk, done);
        });
        return text;
      }
      return await this.llm.generateResponse(wrapped);
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Run multiple completions for the same prompt at once. Used to surface
   * a small set of distinct candidate next-words to the user.
   */
  async completeMany(prompt: string, _count: number): Promise<string[]> {
    if (!this.llm) {
      throw new Error("Gemma is not loaded");
    }
    if (this.inFlight) this.cancel();
    this.inFlight = true;
    try {
      const wrapped = wrapPrompt(prompt);
      // The numResponses option must be set at task-creation time, so for
      // a v0 baseline we just call generateResponses once and let the task
      // return whatever number it was configured for.
      return await this.llm.generateResponses(wrapped);
    } finally {
      this.inFlight = false;
    }
  }

  cancel(): void {
    if (this.llm && this.inFlight) {
      try {
        this.llm.cancelProcessing();
      } catch {
        // best-effort
      }
      this.inFlight = false;
    }
  }

  private async loadFromBuffer(buffer: Uint8Array, sizeBytes: number): Promise<void> {
    this.setStatus({ kind: "loading", message: "Initialising WASM runtime…" });
    const fileset = await FilesetResolver.forGenAiTasks(GENAI_WASM_CDN);

    this.setStatus({ kind: "loading", message: "Loading Gemma into the GPU…" });
    const options: LlmInferenceOptions = {
      baseOptions: {
        // The package types accept either `modelAssetBuffer` or
        // `modelAssetPath`. Buffer = local file picker; path = hosted URL.
        modelAssetBuffer: buffer,
      },
      maxTokens: 512,
      topK: 40,
      temperature: 0.7,
      randomSeed: 1,
      numResponses: 5,
    };
    this.llm = await LlmInference.createFromOptions(fileset, options);
    this.setStatus({
      kind: "ready",
      modelSizeBytes: sizeBytes,
      loadedAt: Date.now(),
    });
  }

  private setStatus(status: GemmaStatus): void {
    this.status = status;
    for (const l of Array.from(this.listeners)) l(status);
  }
}

/**
 * Wrap a raw prompt in the Gemma 3+ chat template.
 *
 * Gemma's instruction-tuned variants expect inputs to be wrapped in
 * <start_of_turn>...<end_of_turn> markers. Without the wrap the model
 * still produces text but quality drops sharply.
 */
function wrapPrompt(prompt: string): string {
  return `<start_of_turn>user\n${prompt}<end_of_turn>\n<start_of_turn>model\n`;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Unknown error loading Gemma";
}

export const gemma = new GemmaService();
