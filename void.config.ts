import { SITE_TITLE } from "#constants.js";
import { defineConfig } from "void/config";

export default defineConfig({
  worker: { compatibility_date: "2026-02-24" },
  // 全ページ共通の <head>。ページごとのタイトル・description・OG は、各ページの head()（src/lib/seo.ts）が出す。
  head: {
    htmlAttrs: { lang: "ja" },
    meta: [
      { charset: "UTF-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1.0" },
      // タブ周りの色を OS のライト/ダークに合わせる。
      { name: "theme-color", content: "#faf6ec", media: "(prefers-color-scheme: light)" },
      { name: "theme-color", content: "#14110c", media: "(prefers-color-scheme: dark)" },
    ],
    link: [
      // favicon はブランドマーク（琥珀のアスタリスク）の SVG。
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "alternate", type: "application/rss+xml", title: SITE_TITLE, href: "/feed.xml" },
    ],
  },
});
