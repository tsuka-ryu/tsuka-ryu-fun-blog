import "#admin/admin.css";

import type { ReactNode } from "react";

// 管理画面の共通の枠は `AdminPage`（#admin/AdminPage.js）。ここでは、管理画面のスタイルを読み込むだけ。
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
