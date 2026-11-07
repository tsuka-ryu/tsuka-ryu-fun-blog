import funstackStatic from "@funstack/static";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    funstackStatic({
      entries: "./src/app/entries.tsx",
      // 生成した HTML と一緒に feed.xml / sitemap.xml を出力する。
      build: "./src/app/build.ts",
      ssr: true,
    }),
    react(),
  ],
  // content/posts/*.md は ?raw で文字列として読む（src/content.ts）。ただし HMR で
  // 再読み込みされるときはクエリが落ちた素の .md として要求されることがあり、Vite が
  // JS として解析しようとして "invalid JS syntax" で落ちる。アセット扱いにしておくと
  // 解析対象から外れ、?raw の読み込みは従来どおり文字列を返す。
  assetsInclude: ["**/*.md"],
  // @ox-content/napi と takumi-js（@takumi-rs/core）はネイティブ（NAPI）モジュール。
  // プラットフォーム固有の `.node` バイナリを Vite がバンドルしようとしないよう
  // external に指定して除外する。
  ssr: {
    external: ["@ox-content/napi", "takumi-js", "@takumi-rs/core"],
  },
  optimizeDeps: {
    // 最初から事前バンドルに含めておく。含めないと初回アクセス時に発見されて再最適化が走り、
    // react/jsx-runtime の共有 export (`t`) が古い ?v= 付きの URL で欠落して
    // "does not provide an export named 't'" で画面が壊れる。
    include: ["@funstack/router", "@paper-design/shaders-react"],
    exclude: ["@ox-content/napi", "takumi-js", "@takumi-rs/core"],
  },
});
