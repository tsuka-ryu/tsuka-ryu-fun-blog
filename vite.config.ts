import funstackStatic from "@funstack/static";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    funstackStatic({
      entries: "./src/entries.tsx",
      // 生成した HTML と一緒に feed.xml / sitemap.xml を出力する。
      build: "./src/build.ts",
      ssr: true,
    }),
    react(),
  ],
  // @ox-content/napi と takumi-js（@takumi-rs/core）はネイティブ（NAPI）モジュール。
  // プラットフォーム固有の `.node` バイナリを Vite がバンドルしようとしないよう
  // external に指定して除外する。
  ssr: {
    external: ["@ox-content/napi", "takumi-js", "@takumi-rs/core"],
  },
  optimizeDeps: {
    exclude: ["@ox-content/napi", "takumi-js", "@takumi-rs/core"],
  },
});
