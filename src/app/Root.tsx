import { SITE_TITLE } from "#constants.js";

import type { ReactNode } from "react";

// 全ページ共通の HTML シェル（Server Component）。
// <html>〜<body> を組み立て、children に各ページ本文が入る。
// title / description / OG タグは各ページの <Seo> が出力し、React 19 の
// Document Metadata 機能でこの <head> に自動で巻き上げられる。
// RSS フィードへの <link> もここで全ページ共通として配置する。
export default function Root({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="alternate" type="application/rss+xml" title={SITE_TITLE} href="/feed.xml" />
      </head>
      <body>{children}</body>
    </html>
  );
}
