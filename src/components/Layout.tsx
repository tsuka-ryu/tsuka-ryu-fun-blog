import { Suspense } from "react";
import { Outlet } from "@funstack/router";
import { Header } from "#components/Header.js";
import { Footer } from "#components/Footer.js";

// 全ページ共通の枠組み。ヘッダー／フッターで本文（Outlet）を挟む。
// 本文はルートごとに defer されるため Suspense で囲む。
export function Layout() {
  return (
    <div className="layout">
      <Header />
      <main className="main">
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
