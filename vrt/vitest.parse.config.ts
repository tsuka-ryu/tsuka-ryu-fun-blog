import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// 自作の Markdown パーサーの単体テストを、ブラウザ（Chromium）で動かす設定。
// パーサーはサーバーとブラウザ（エディタのプレビュー）で同じコードを使うので、どちらでも同じ結果になることを確かめる。
// Node 専用の API を使う golden.test.ts は対象外。
export default defineConfig({
  root: new URL("..", import.meta.url).pathname,
  test: {
    include: ["src/markdown/parse/parse.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: process.env.VRT_CHROMIUM_PATH
          ? { executablePath: process.env.VRT_CHROMIUM_PATH }
          : {},
      }),
      instances: [{ browser: "chromium" }],
    },
  },
});
