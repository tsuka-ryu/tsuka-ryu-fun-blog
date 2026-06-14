"use client";

import { Router, type RouteDefinition } from "@funstack/router";
// Web フォントは Zen Kaku Gothic New ひとつに絞る（読み込むファミリーを減らす）。
// 日本語を表示する以上は日本語フォントが必須で、これは欧文もカバーするため本文・
// 見出し兼用にできる。等幅の体裁は OS 標準の等幅フォントで賄い、Web フォントは増やさない。
// ローカルに同梱して配信する（外部 CDN は接続待ちで描画後に差し替わりチラつくため）。
// unicode-range でサブセット分割されており、表示に必要な範囲の woff2 だけが読み込まれる。
import "@fontsource/zen-kaku-gothic-new/400.css";
import "@fontsource/zen-kaku-gothic-new/700.css";
import "#styles.css";

// アプリのクライアント側エントリ（Client Component）。
// @funstack/router の <Router> をラップし、ルート定義を渡してクライアントの
// ルーティングとハイドレーションを担う。SSR 時は ssrPath で対象パスを Router に伝え、
// グローバル CSS（#styles.css）もここで読み込む。
export function ClientApp({
  routes,
  ssrPath,
}: {
  routes: RouteDefinition[];
  ssrPath?: string;
}) {
  return (
    <Router
      routes={routes}
      fallback="static"
      ssr={ssrPath ? { path: ssrPath } : undefined}
    />
  );
}
