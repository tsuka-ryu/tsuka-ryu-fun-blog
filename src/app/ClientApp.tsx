"use client";

import { Router, type RouteDefinition } from "@funstack/router";
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
