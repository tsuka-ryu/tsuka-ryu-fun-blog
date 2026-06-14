# tsuka-ryu fun blog

[FUNSTACK Static](https://www.npmjs.com/package/@funstack/static) で作る静的技術ブログ。
ビルド時に全ページを HTML として吐き出すため、**ランタイムにサーバーは不要**。生成物
（HTML / RSC ペイロード / 検索インデックス / RSS / sitemap / OG 画像）を静的ホスティングに
置くだけで動く。

## 特徴

- **React Server Components ベースの SSG** — 記事本文や Markdown 変換はビルド時のサーバー
  環境だけで描画し、クライアント JS を最小化（"島" だけが JS）。
- **Rust 製ツールチェーン** — Markdown 変換・全文検索インデックス（[ox-content](https://www.npmjs.com/package/@ox-content/napi)）、
  OG 画像生成（[takumi-js](https://www.npmjs.com/package/takumi-js)）はネイティブで高速。
  いずれもブラウザには載らない。
- **ビルド時シンタックスハイライト**（shiki）— 色を HTML に焼き込むのでハイライタは
  クライアントに送られない。light/dark のデュアルテーマに CSS 変数で追従。
- **全文検索** — ox-content が出力する純 JS の BM25 ランタイム（CJK 対応）をクライアントへ。
- **SEO / 配信物** — 記事ごとの OG 画像、RSS（`feed.xml`）、`sitemap.xml`、canonical/OG メタを自動生成。
- **壊れた記事はビルドで弾く** — frontmatter / URL スキーム / Markdown lint をビルド時に検証。

## 技術スタック

| ツール | 役割 |
| --- | --- |
| `@funstack/static` | RSC ベースの静的サイト生成（SSG） |
| `@funstack/router` | Navigation API ベースのルーティング & クライアント遷移 |
| `@ox-content/napi` | Rust 製 Markdown → mdast 変換・全文検索インデックス生成 |
| `shiki` | ビルド時シンタックスハイライト |
| `takumi-js` | ビルド時 OG 画像生成（Rust 製、ヘッドレスブラウザ不要） |
| React 19 / Vite 8 | UI / バンドラ |

## 必要環境

- Node.js `>=24.16.0`、pnpm `>=11.6.0`（`mise.toml` でピン留め。`mise install` で導入）
- TypeScript はネイティブ版 [`@typescript/native-preview`](https://www.npmjs.com/package/@typescript/native-preview)（`tsgo`）に一本化

## セットアップ & コマンド

```bash
mise install      # Node / pnpm を mise.toml のバージョンで導入
pnpm install      # 依存をインストール

pnpm dev          # 開発サーバー（検索/OG はビルド時生成なので dev では無効）
pnpm build        # dist/public/ に静的ファイル一式を生成
pnpm preview      # 既存ビルドをローカル配信
pnpm start        # build → preview を一発
pnpm typecheck    # 型チェック（tsgo --noEmit）
```

## ディレクトリ構成

```
content/posts/*.md   記事のソース（frontmatter + Markdown）
src/
├─ app/         フレームワーク結線（Root / App / ClientApp / entries / build）
├─ markdown/    mdast → React レンダラー（+ shiki ハイライト）
├─ lib/         ユーティリティ（toc / time / feed / search / og）
├─ og/          OG カード + 同梱フォント
├─ components/  UI 部品（Layout / Header / Footer / PostCard / TagList / PostToc / SearchBox / Seo / ShaderGimmick）
├─ pages/       ページ（Home / Post / About / Tags / Tag / NotFound）
├─ styles.css   全体スタイル
├─ content.ts   記事読み込み & ox-content 変換 + ビルド時検証
└─ constants.ts サイト共通定数（SITE_TITLE / SITE_DESCRIPTION / SITE_URL / SITE_TIME_ZONE）
```

設計上の判断（なぜこの構成か）は [docs/architecture.md](docs/architecture.md)、検索の仕組みは
[docs/search.md](docs/search.md)、実際の作業履歴は [docs/build-log.md](docs/build-log.md) を参照。

### 規約

- **import は subpath imports** — 相対パスではなく `package.json` の `"imports": { "#*": "./src/*" }`
  を使う（例 `#lib/toc.js` / `#app/App.js`、拡張子は `.js` 規約）。
- **コメントは日本語**。各ファイルの主要な関数/エクスポートの直上に役割コメントを置く。
- 詳細な開発方針は [CLAUDE.md](CLAUDE.md) を参照。

## 記事の書き方

`content/posts/<slug>.md` に frontmatter 付き Markdown を置くと、ファイル名が URL スラッグ
（`/posts/<slug>`）になる。

```markdown
---
title: 記事のタイトル
date: 2026-06-07
description: 一覧やメタに使う短い説明（任意）
tags: [react, ssg]
---

本文（GFM: テーブル / タスクリスト / 打ち消し / オートリンク対応）。
```

`title`（非空）と `date`（`YYYY-MM-DD`）は必須。満たさない記事・危険な URL スキームを含む
記事・lint に引っかかる記事はビルドが失敗する。

## デプロイ

```bash
pnpm build        # → dist/public/
```

`dist/public/` を任意の静的ホスティング（Netlify / Vercel / Cloudflare Pages / GitHub Pages 等）へ
デプロイする。本番オリジンは `src/constants.ts` の `SITE_URL` が単一情報源（canonical / OG /
RSS / sitemap の絶対 URL に使われる）。