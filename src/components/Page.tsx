import { Footer } from "#components/Footer.js";
import { Header } from "#components/Header.js";

import type { ReactNode } from "react";

// ページの枠組み（ヘッダー・本文・フッター）。レイアウトではなく各ページが使う。
//
// アイランド（検索欄など）は、ページのファイルで `with { island: ... }` を付けて import したものだけが
// ブラウザで動く（レイアウトの中のアイランドは、描画されるだけで動かない）。そのため、ヘッダーの検索欄は、
// 各ページがアイランドとして作って、`search` で渡す。
export function Page({ search, children }: { search?: ReactNode; children: ReactNode }) {
  return (
    <>
      <Header search={search} />
      <main className="main">{children}</main>
      <Footer />
    </>
  );
}
