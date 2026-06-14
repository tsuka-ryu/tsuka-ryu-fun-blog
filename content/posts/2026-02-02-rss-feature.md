---
title: RSSフィードについて
description: RSSフィードを改善したのでメモ
date: 2026-02-02
tags: ["ブログ盆栽", "RSSフィード"]
---

RSSフィードの実装を改善したのでメモります。

## 発端

自分は普段inoreaderを使って情報収集をしています。そのため、このブログを作ったときも自然とRSSフィードの機能をつけてニヤニヤしていました。

ただ、いくつかの記事を見るうちに、見出しがうまく表示されていないことに気がつきました。原因の詳細は不明なのですが、おそらくHTMLの構造が複雑なので、inoreaderのパーサーが複雑なHTML構造を適切に処理できていないことがわかりました。

以下のようにヘッダータグ内に`svg`が含まれる複雑な構造になっています。

```html
<h2 class="flex scroll-m-28 flex-row items-center gap-2" id="tldr">
  <a data-card="" href="#tldr" class="peer">tl;dr</a
  ><svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="lucide lucide-link size-3.5 shrink-0 text-fd-muted-foreground opacity-0 transition-opacity peer-hover:opacity-100"
    aria-hidden="true"
  >
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
  </svg>
</h2>
```

## 修正その①

Claudeと相談した結果、RSS用にクエリパラメータを付与すると良いということなので、その通りに修正しました。[実際の修正PR](https://github.com/tsuka-ryu/tsuka-ryu-s-blog/pull/3)。

```jsx
// 主要な部分を抜粋
const searchParams = await props.searchParams;

const isRSSView = searchParams?.view === "rss";

const components = isRSSView
  ? {
      h1: "h1",
      h2: "h2",
      h3: "h3",
      h4: "h4",
      h5: "h5",
      h6: "h6",
    }
  : undefined;

// クエリパラメータがある場合は、`getMDXComponents`のヘッダータグを上書き
<Mdx components={getMDXComponents(components)} />;
```

## 修正その②

その後にふとした拍子に`/blog/[slug]`がSSGされていないことに気がつきました。`searchParams`を使ってるから当然なのですが、前の修正時には気づかなかったですね。

```bash
Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /about
├ ƒ /api/search
├ ○ /blog
├ ƒ /blog/[slug]
├ ○ /blog/rss.xml
├ ● /docs/[[...slug]]
│ ├ /docs
│ └ /docs/test
├ ○ /icon.png
└ ● /og/blog/[...slug]
  ├ /og/blog/2025-12-30-my-blog/image.webp
  ├ /og/blog/2025-12-31-recap/image.webp
  ├ /og/blog/2026-01-11-og-image/image.webp
  └ [+2 more paths]


○  (Static)   prerendered as static content
●  (SSG)      prerendered as static HTML (uses generateStaticParams)
ƒ  (Dynamic)  server-rendered on demand
```

なので、クエリパラメータをやめて、`/blog/[slug]/rss`というパスパラメータにすることにしました。

ビルド時にちゃんとSSGされるようになったので問題ないと思います。

```bash
Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /about
├ ƒ /api/search
├ ○ /blog
├ ● /blog/[slug]
│ ├ /blog/2025-12-30-my-blog
│ ├ /blog/2025-12-31-recap
│ ├ /blog/2026-01-11-og-image
│ └ [+2 more paths]
├ ● /blog/[slug]/rss
│ ├ /blog/2025-12-30-my-blog/rss
│ ├ /blog/2025-12-31-recap/rss
│ ├ /blog/2026-01-11-og-image/rss
│ └ [+2 more paths]
├ ○ /blog/rss.xml
├ ● /docs/[[...slug]]
│ ├ /docs
│ └ /docs/test
├ ○ /icon.png
└ ● /og/blog/[...slug]
  ├ /og/blog/2025-12-30-my-blog/image.webp
  ├ /og/blog/2025-12-31-recap/image.webp
  ├ /og/blog/2026-01-11-og-image/image.webp
  └ [+2 more paths]


○  (Static)   prerendered as static content
●  (SSG)      prerendered as static HTML (uses generateStaticParams)
ƒ  (Dynamic)  server-rendered on demand
```

## まとめ

RSSフィードの対応をしました。

App routerをちゃんと使ったことないので、こういう勘所がないということに気がつきました。

意図しない変更を避けるために、ビルド結果のsnapshotの差分を見たほうがいいかも？とも思いました。こういう気づきがあるので個人開発はいいですね。

---

_最終更新: 2026年2月2日_
