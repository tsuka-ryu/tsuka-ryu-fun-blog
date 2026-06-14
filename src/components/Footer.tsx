import { SITE_TITLE } from "#constants.js";
import { nowInTokyo } from "#lib/time.js";

// サイト共通のフッター。静的な表示のみで状態を持たない Server Component。
// コピーライトの年は JST 固定（nowInTokyo）で出し、システム TZ に依存させない。
export function Footer() {
  const year = nowInTokyo().year;

  return (
    <footer className="footer">
      <p>
        Built with <strong>FUNSTACK Static</strong>,{" "}
        <strong>FUNSTACK Router</strong> &amp; <strong>ox-content</strong>.
      </p>
      <p className="footer-copyright">
        © {year} {SITE_TITLE}
      </p>
    </footer>
  );
}
