"use client";

import type { ReactNode } from "react";
import { useLocation } from "@funstack/router";
import { SearchBox } from "#components/SearchBox.js";
import { SITE_TITLE, SOCIAL_LINKS } from "#constants.js";

// グローバルナビの項目。パスとラベルの組。ホーム（/）はブランド名がリンクを
// 兼ねるため Home は置かず、Tags / About のみを並べる。
const navItems = [
  { path: "/tags", label: "Tags" },
  { path: "/about", label: "About" },
];

// ソーシャルアイコン（key → SVG）。constants.ts の SOCIAL_LINKS と対応。
const socialIcons: Record<string, ReactNode> = {
  github: (
    <svg role="img" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 1200 1227" fill="currentColor" aria-hidden="true">
      <path d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.828Z" />
    </svg>
  ),
  zenn: (
    <svg viewBox="0 0 88.3 88.3" fill="currentColor" aria-hidden="true">
      <path d="M3.9,83.3h17c0.9,0,1.7-0.5,2.2-1.2L69.9,5.2c0.6-1-0.1-2.2-1.3-2.2H52.5c-0.8,0-1.5,0.4-1.9,1.1L3.1,81.9C2.8,82.5,3.2,83.3,3.9,83.3z" />
      <path d="M62.5,82.1l22.1-35.5c0.7-1.1-0.1-2.5-1.4-2.5h-16c-0.6,0-1.2,0.3-1.5,0.8L43,81.2c-0.6,0.9,0.1,2.1,1.2,2.1h16.3C61.3,83.3,62.1,82.9,62.5,82.1z" />
    </svg>
  ),
};

// サイト共通のヘッダー。現在地（pathname）に応じてナビをアクティブ表示する
// ため、ルーターのフックを使う Client Component。
export function Header() {
  const { pathname } = useLocation();

  // pathname は URL 由来で最低でも "/"。ホームは完全一致、他も完全一致で判定。
  const isActive = (path: string) => pathname === path;

  return (
    <header className="header">
      <div className="header-inner">
        <div className="header-left">
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
        <div className="header-right">
          <SearchBox />
          <span className="nav-social">
            {SOCIAL_LINKS.map((social) => (
              <a
                key={social.key}
                href={social.url}
                className="social-link"
                aria-label={social.label}
                target="_blank"
                rel="noopener noreferrer"
              >
                {socialIcons[social.key]}
              </a>
            ))}
          </span>
        </div>
      </div>
    </header>
  );
}