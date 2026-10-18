import {
  ASSET_KEY_PATTERN,
  MAX_IMAGE_BYTES,
  checkImage,
  newAssetKey,
  randomHex,
} from "#site/assets.js";
import { describe, expect, it } from "vitest";

const bytes = (...values: number[]) => Uint8Array.from(values);
const webp = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0);

describe("checkImage", () => {
  it("PNG / JPEG / GIF / WebP を、中身から判定する", () => {
    expect(checkImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toEqual({
      ok: true,
      type: "image/png",
    });
    expect(checkImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toEqual({ ok: true, type: "image/jpeg" });
    expect(checkImage(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toEqual({
      ok: true,
      type: "image/gif",
    });
    expect(checkImage(webp)).toEqual({ ok: true, type: "image/webp" });
  });

  it("SVG・HTML・空・大きすぎるものは断る", () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    expect(checkImage(svg)).toEqual({ ok: false, reason: "unsupported" });
    expect(checkImage(new TextEncoder().encode("<html>"))).toEqual({
      ok: false,
      reason: "unsupported",
    });
    expect(checkImage(new Uint8Array())).toEqual({ ok: false, reason: "empty" });
    expect(checkImage(new Uint8Array(MAX_IMAGE_BYTES + 1))).toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("RIFF だけで WebP ではない（WAV など）ものは断る", () => {
    expect(checkImage(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45))).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });
});

describe("newAssetKey", () => {
  it("年月とランダムな名前で、拡張子は判定した種類から決める", () => {
    const key = newAssetKey("image/webp", new Date(Date.UTC(2026, 9, 18)), randomHex());
    expect(key).toMatch(ASSET_KEY_PATTERN);
    expect(key.startsWith("uploads/2026/10/")).toBe(true);
    expect(key.endsWith(".webp")).toBe(true);
  });

  it("配信側のキーの検証は、パスの抜け出しや別の接頭辞を通さない", () => {
    for (const bad of [
      "uploads/../secret",
      "published/index.json",
      "uploads/2026/10/x.webp",
      "uploads/2026/10/" + "a".repeat(32) + ".svg",
    ]) {
      expect(ASSET_KEY_PATTERN.test(bad), bad).toBe(false);
    }
  });
});
