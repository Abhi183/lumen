import { describe, expect, it } from "vitest";
import { staticPredict, __INTERNAL } from "./staticPredictor";

describe("staticPredict", () => {
  it("returns top unigrams for an empty text", () => {
    const out = staticPredict("");
    expect(out.length).toBe(__INTERNAL.MAX_SUGGESTIONS);
    expect(out[0].word).toBe("the");
  });

  it("returns top unigrams when the text ends with a space", () => {
    const out = staticPredict("hello ");
    expect(out.length).toBe(__INTERNAL.MAX_SUGGESTIONS);
  });

  it("matches by prefix when typing mid-word", () => {
    const out = staticPredict("wa");
    const words = out.map((p) => p.word);
    // Should include words starting with "wa" from the vocab.
    expect(words.some((w) => w.startsWith("wa"))).toBe(true);
    expect(words).toContain("water");
  });

  it("falls back to top unigrams when no prefix matches", () => {
    const out = staticPredict("xyz");
    expect(out.length).toBe(__INTERNAL.MAX_SUGGESTIONS);
    expect(out[0].word).toBe("the");
  });

  it("respects sentence position when computing the prefix", () => {
    const out = staticPredict("I want wa");
    const words = out.map((p) => p.word);
    expect(words).toContain("water");
  });

  it("never returns more than MAX_SUGGESTIONS items", () => {
    const out = staticPredict("th");
    expect(out.length).toBeLessThanOrEqual(__INTERNAL.MAX_SUGGESTIONS);
  });
});
