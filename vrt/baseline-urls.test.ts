import { describe, expect, it } from "vitest";

import { pathFromBaselineFile, pathsFromBaselines } from "./baseline-urls.ts";

describe("ベースライン画像のファイル名から URL を復元する", () => {
  it("トップ・固定ページ・記事・タグ", () => {
    expect(pathFromBaselineFile("home-desktop-chromium-linux.png")).toBe("/");
    expect(pathFromBaselineFile("about-mobile-chromium-linux.png")).toBe("/about");
    expect(pathFromBaselineFile("posts__2026-05-09-end-of-gw-desktop-chromium-linux.png")).toBe(
      "/posts/2026-05-09-end-of-gw",
    );
    expect(pathFromBaselineFile("tags__oxc-desktop-chromium-linux.png")).toBe("/tags/oxc");
  });

  it("縦に長くて分けて撮った画像は、元の URL に戻し、重複を除く", () => {
    expect(
      pathsFromBaselines([
        "posts__long-desktop-1of2-chromium-linux.png",
        "posts__long-desktop-2of2-chromium-linux.png",
        "posts__long-mobile-1of3-chromium-linux.png",
      ]),
    ).toEqual(["/posts/long"]);
  });

  it("404 の画面と、画像ではないファイルは除く", () => {
    expect(pathFromBaselineFile("this-page-does-not-exist-desktop-chromium-linux.png")).toBeNull();
    expect(pathFromBaselineFile("README.md")).toBeNull();
  });
});
