import path from "node:path";

import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { PREVIEW_PORT } from "./global-setup.ts";

const root = import.meta.dirname;

export default defineConfig({
  root,
  // 対象のサイト（global-setup.ts が起動する Void のプレビュー）のページとアセットは、Vitest の内部の
  // パス以外をすべて、そのサーバーに転送して配る。こうして、テストのページと同じオリジンにして、iframe の
  // 中身を操作できるようにする（別のオリジンだと、高さの測定やアニメーションの停止ができない）。
  server: {
    proxy: {
      "^/(?!__vitest|@vite|@id|@fs|@react-refresh|node_modules|\\.vite|.*\\.test\\.ts|.*\\.config\\.ts)":
        {
          target: `http://localhost:${PREVIEW_PORT}`,
          changeOrigin: true,
        },
    },
  },
  test: {
    globalSetup: [path.join(root, "global-setup.ts")],
    include: ["*.browser.test.ts"],
    // 画像比較は並列に走らせると描画タイミングが揺れるので 1 ファイルずつ走らせる。
    fileParallelism: false,
    testTimeout: 60_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        // Playwright が期待する Chromium と別の場所にある環境（CI のコンテナなど）では、
        // VRT_CHROMIUM_PATH で実行ファイルを指定する。未指定なら Playwright の既定を使う。
        launchOptions: process.env.VRT_CHROMIUM_PATH
          ? { executablePath: process.env.VRT_CHROMIUM_PATH }
          : {},
        // ライト固定・アニメーション抑制で描画を安定させる。
        contextOptions: { colorScheme: "light", reducedMotion: "reduce", locale: "ja-JP" },
      }),
      instances: [{ browser: "chromium" }],
    },
  },
});
