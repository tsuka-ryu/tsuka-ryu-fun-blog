import { FOOTER_SIGNOFF, SITE_NAME } from "#constants.js";
import { nowInTokyo } from "#lib/time.js";

// サイト共通のフッター。静的な表示のみで状態を持たない Server Component。
// コピーライトの年は JST 固定（nowInTokyo）で出し、システム TZ に依存させない。
// 左にクレジット、右に結びの一言を置く。
export function Footer() {
  const year = nowInTokyo().year;

  return (
    <footer className="footer">
      <span className="footer-credit">
        © {year} {SITE_NAME} — built with FUNSTACK
      </span>
      <span className="footer-signoff">{FOOTER_SIGNOFF}</span>
    </footer>
  );
}
