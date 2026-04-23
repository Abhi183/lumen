import { describe, expect, it } from "vitest";
import { staticPredict, __INTERNAL } from "./staticPredictor";

describe("staticPredict", () => {
  it("returns starters for an empty text", () => {
    const out = staticPredict("");
    expect(out.length).toBe(__INTERNAL.MAX_SUGGESTIONS);
    // First starter should be the AAC-oriented "i".
    expect(out[0].word).toBe("i");
  });

  it("returns bigram continuations when the text ends with a known word and space", () => {
    const out = staticPredict("i ");
    const words = out.map((p) => p.word);
    // After "i " we expect bigram completions like "am", "need", "want".
    expect(words).toContain("need");
  });

  it("matches by prefix when typing mid-word", () => {
    const out = staticPredict("wa");
    const words = out.map((p) => p.word);
    expect(words.some((w) => w.startsWith("wa"))).toBe(true);
    expect(words).toContain("water");
  });

  it("falls back to starters when no prefix matches", () => {
    const out = staticPredict("xyz");
    expect(out.length).toBe(__INTERNAL.MAX_SUGGESTIONS);
    expect(out[0].word).toBe("i");
  });

  it("respects sentence position when computing the prefix", () => {
    const out = staticPredict("I want wa");
    const words = out.map((p) => p.word);
    expect(words).toContain("water");
  });

  it("suggests bigram continuations after a known previous word", () => {
    const out = staticPredict("please ");
    const words = out.map((p) => p.word);
    // "please" is in BIGRAMS with entries like "help", "wait".
    expect(words).toContain("help");
  });

  it("never returns more than MAX_SUGGESTIONS items", () => {
    const out = staticPredict("th");
    expect(out.length).toBeLessThanOrEqual(__INTERNAL.MAX_SUGGESTIONS);
  });
});
