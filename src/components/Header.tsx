"use client";

import { useLocation } from "@funstack/router";
import { SITE_TITLE } from "#constants.js";

// グローバルナビの項目。パスとラベルの組。
const navItems = [
  { path: "/", label: "Home" },
  { path: "/about", label: "About" },
];

// サイト共通のヘッダー。現在地（pathname）に応じてナビをアクティブ表示する
// ため、ルーターのフックを使う Client Component。
export function Header() {
  const { pathname } = useLocation();

  // pathname は URL 由来で最低でも "/"。ホームは完全一致、他も完全一致で判定。
  const isActive = (path: string) => pathname === path;

  return (
    <header className="header">
      <div className="header-inner">
        <a href="/" className="brand">
          {SITE_TITLE}
        </a>
        <nav className="nav">
          {navItems.map((item) => {
            const active = isActive(item.path);
            return (
              <a
                key={item.path}
                href={item.path}
                className={active ? "nav-link active" : "nav-link"}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
