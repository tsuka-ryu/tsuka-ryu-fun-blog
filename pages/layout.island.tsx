import { Footer } from "#components/Footer.js";
import { Header } from "#components/Header.js";

import "#styles.css";
// Web フォントは Zen Kaku Gothic New ひとつに絞る（読み込むファミリーを減らす）。
// 日本語を表示する以上は日本語フォントが必須で、これは欧文もカバーするため本文・
// 見出し兼用にできる。等幅の体裁は OS 標準の等幅フォントで賄い、Web フォントは増やさない。
// ローカルに同梱して配信する（外部 CDN は接続待ちで描画後に差し替わりチラつくため）。
// unicode-range でサブセット分割されており、表示に必要な範囲の woff2 だけが読み込まれる。
import "@fontsource/zen-kaku-gothic-new/400.css";
import "@fontsource/zen-kaku-gothic-new/700.css";

import type { ReactNode } from "react";

// 全ページ共通の枠組み。ヘッダー／フッターで本文を挟む。
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="layout">
      <Header />
      <main className="main">{children}</main>
      <Footer />
    </div>
  );
}
