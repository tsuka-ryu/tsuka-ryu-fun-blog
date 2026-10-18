import { Page } from "#components/Page.js";

import type { ReactNode } from "react";

// 管理画面の枠（サイトのヘッダー・フッターの内側に、管理画面のナビを置く）。
// ログアウトのボタンはアイランドなので、各ページのファイルで作って `signOut` に渡す（理由は #components/Page.js）。
export function AdminPage({ signOut, children }: { signOut?: ReactNode; children: ReactNode }) {
  return (
    <Page>
      <div className="admin">
        <nav className="admin-nav" aria-label="管理画面">
          <a href="/admin">記事</a>
          <a href="/admin/posts/new">新規作成</a>
          <a href="/admin/tags">タグ</a>
          <span className="admin-spacer" />
          {signOut}
        </nav>
        {children}
      </div>
    </Page>
  );
}
