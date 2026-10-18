import { SITE_TITLE } from "#constants.js";
import { defineConfig } from "void/config";

export default defineConfig({
  worker: { compatibility_date: "2026-02-24" },
  routing: {
    // URL の揺れ（末尾スラッシュ・`.html`）は、正規の URL に 301 で寄せる。被リンクや検索エンジンの
    // 評価、RSS の購読を壊さないため。リダイレクトはワーカーに届く前に評価される。
    redirects: {
      "/posts/*.html": { to: "/posts/:splat", status: 301 },
      "/tags/*.html": { to: "/tags/:splat", status: 301 },
      "/about.html": { to: "/about", status: 301 },
      "/index.html": { to: "/", status: 301 },
      "/posts/*/": { to: "/posts/:splat", status: 301 },
      "/tags/*/": { to: "/tags/:splat", status: 301 },
      "/posts/": { to: "/", status: 301 },
      "/tags/": { to: "/tags", status: 301 },
      "/about/": { to: "/about", status: 301 },
    },
  },
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
