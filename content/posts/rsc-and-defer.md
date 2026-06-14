---
title: RSC と defer() で記事を軽量配信する
date: 2026-06-01
description: FUNSTACK Static の defer() がどのように記事ごとの RSC ペイロードを分割し、クライアント遷移を高速化するか。
tags:
  - rsc
  - performance
  - funstack
---

# RSC と defer() で記事を軽量配信する

FUNSTACK Static では、記事本文は **Server Component** としてビルド時に描画されます。
つまり Markdown を HTML へ変換するコード（ox-content の native モジュール）は、
**クライアントには一切送られません**。

## defer() の役割

各ルートのコンポーネントを `defer()` で包むと、その描画結果が独立した RSC ペイロードとして
出力されます。

```tsx
import { defer } from "@funstack/static/server";

route({
  path: "/posts/hello-funstack",
  component: defer(<PostPage slug="hello-funstack" />, {
    name: "Post-hello-funstack",
  }),
});
```

これにより:

- 初回ロードで全記事のデータを待つ必要がなくなる
- クライアント側のページ遷移時に、その記事のペイロードだけを取得する

## まとめ

`defer()` は「Server Component 版の `lazy()`」と考えると分かりやすいです。
コンテンツ重視のサイトでは、各ルートを `defer()` で包むのが定石です。
