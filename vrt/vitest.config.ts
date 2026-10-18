import { existsSync } from "node:fs";
import path from "node:path";

import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import type { Plugin } from "vite";

const root = import.meta.dirname;
// ビルド済みの静的サイト。Vite の publicDir として配り、変換を一切かけずにそのまま返す。
const siteDir = path.resolve(root, "../dist/public");

// Vercel の cleanUrls と同じ解決を再現する。`/posts/x` → `posts/x.html`、
// 存在しないパス → 404.html（ステータス 404）。サイトのクライアントルーターは
// 実際の URL のパスでルートを照合するので、`.html` 付きの URL では 404 画面になってしまう。
function cleanUrls(): Plugin {
  return {
    name: "vrt-clean-urls",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const pathname = decodeURIComponent(url.pathname);
        // Vitest 自身のリソースや、拡張子つきの静的ファイルはそのまま通す。
        if (pathname.startsWith("/__") || pathname.startsWith("/@") || path.extname(pathname)) {
          return next();
        }
        const candidate = pathname === "/" ? "index.html" : `${pathname.slice(1)}.html`;
        if (existsSync(path.join(siteDir, candidate))) {
          req.url = `/${candidate}${url.search}`;
        } else if (pathname !== "/") {
          req.url = "/404.html";
          res.statusCode = 404;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  root,
  publicDir: siteDir,
  plugins: [cleanUrls()],
  test: {
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
