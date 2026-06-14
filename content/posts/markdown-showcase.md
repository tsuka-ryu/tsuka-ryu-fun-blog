---
title: Markdown 表現力ショーケース
date: 2026-06-05
description: ox-content がサポートする GFM・テーブル・タスクリスト・コードブロック・脚注などを一通り試す。
tags:
  - markdown
  - ox-content
---

# Markdown 表現力ショーケース

ox-content は GitHub Flavored Markdown（GFM）を含む豊富な記法をサポートしています。

## テキスト装飾

**太字**、*斜体*、~~取り消し線~~、そして `inline code` が使えます。

## リスト

- 箇条書き 1
- 箇条書き 2
  - ネストした項目
- 箇条書き 3

1. 番号付き 1
2. 番号付き 2

## タスクリスト

- [x] ox-content を導入する
- [x] Markdown を変換する
- [ ] OG 画像を生成する

## テーブル

| ライブラリ        | 役割                       |
| ----------------- | -------------------------- |
| FUNSTACK Static   | RSC ベースの静的サイト生成 |
| FUNSTACK Router   | Navigation API ルーター    |
| ox-content        | Markdown 変換              |

## コードブロック

```ts
import { transform } from "@ox-content/napi";

const result = transform("# Hello", { gfm: true, frontmatter: true });
console.log(result.html); // "<h1>Hello</h1>"
```

## 引用

> 速さは正義。ox-content はアリーナアロケータと zero-copy parsing で高速に動作します。

## リンク

[FUNSTACK Router のドキュメント](https://router.funstack.work/) もどうぞ。
