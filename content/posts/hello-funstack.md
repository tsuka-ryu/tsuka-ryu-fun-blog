---
title: FUNSTACK で技術ブログを始める
date: 2026-06-07
description: FUNSTACK Static・FUNSTACK Router・ox-content を組み合わせて、サーバー不要の静的技術ブログを作る話。
tags:
  - funstack
  - ssg
  - react
---

# FUNSTACK で技術ブログを始める

このブログは **FUNSTACK Static**（Vite + React Server Components）、**FUNSTACK Router**
（Navigation API ベースのルーター）、そして **ox-content**（Rust 製の Markdown ツールキット）の
3 つを組み合わせて作られています。

## なぜこの構成なのか

- **サーバー不要** — ビルド時にすべてのページを HTML へ事前生成するので、任意の静的ホスティングに置けます。
- **RSC によるゼロ JS なコンテンツ** — 記事本文は Server Component として描画され、JavaScript を増やしません。
- **高速な Markdown 変換** — ox-content の Rust パーサーが frontmatter・GFM・TOC をまとめて処理します。

## 仕組み

各記事は `content/posts/*.md` に置かれ、ビルド時に次のように処理されます。

1. Vite の `import.meta.glob` で Markdown を生文字列として読み込む
2. ox-content の `transform()` で HTML・frontmatter・目次へ変換する
3. FUNSTACK Router のルート定義へ変換し、`entries.tsx` が記事ごとに HTML を生成する

> 記事を追加したいときは、このディレクトリに `.md` を 1 つ足すだけです。

次の記事では Markdown の表現力を試してみましょう。
