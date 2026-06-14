// Open Graph カード。ビルド時に Takumi が 1200×630 の PNG に描画する（src/lib/og.ts）。
// これは DOM / RSC コンポーネントではなく、Takumi が要素ツリーを satori 風に解釈する。
// そのため複数子を持つボックスはすべて display: flex を指定し、テキストは同梱の
// "Noto Sans JP" フォントを使う。
//
// 配色はサイト本体（温かい紙の地・墨色の本文・くすませた琥珀のアクセント）に合わせる。
// 上端の琥珀の帯とブランド名脇のアスタリスクで、サイトと同じ表情を SNS カードでも出す。
export interface OgCardProps {
  /** タイトルの上に表示するサイト名。 */
  siteName: string;
  /** 記事タイトル（主役のテキスト）。 */
  title: string;
  /** 補助行。例: "react · ssg · 2026年6月7日"。 */
  meta?: string;
}

// サイトの配色トークン（src/styles.css のダークテーマ :root と対応）。OG は単一の
// 静止画なので、SNS のタイムラインで沈んで映えるダーク（温かい黒地）で固定する。
const PAPER = "#14110c";
const INK = "#ede6d8";
const SOFT = "#968c7b";
const ACCENT = "#e8833c";

// ブランドの手描き風アスタリスク（Asterisk.tsx と同じ 3 ストローク）。
function BrandAsterisk() {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24">
      <g fill="none" stroke={ACCENT} strokeWidth="2.6" strokeLinecap="round">
        <path d="M12 3.2 L12 20.8" />
        <path d="M4.4 7 L19.4 17.4" />
        <path d="M19.6 6.6 L4.6 17.2" />
      </g>
    </svg>
  );
}

export function OgCard({ siteName, title, meta }: OgCardProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "1200px",
        height: "630px",
        padding: "80px",
        // 上端にブランド色の帯を引いて、紙地に琥珀の差し色を効かせる。
        borderTop: `12px solid ${ACCENT}`,
        backgroundColor: PAPER,
        color: INK,
        fontFamily: "Noto Sans JP",
      }}
    >
      {/* サイト名＋アスタリスク（ヘッダーのブランド表記と同じ並び）。 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "14px",
          color: ACCENT,
          fontSize: "36px",
        }}
      >
        <span style={{ display: "flex" }}>{siteName}</span>
        <BrandAsterisk />
      </div>
      <div
        style={{
          display: "flex",
          fontSize: "68px",
          lineHeight: 1.25,
          color: INK,
          // 上下のサイト名 / メタ行ぶんの余白を確保する。
          maxHeight: "340px",
          overflow: "hidden",
        }}
      >
        {title}
      </div>
      <div style={{ display: "flex", color: SOFT, fontSize: "28px" }}>{meta ?? ""}</div>
    </div>
  );
}
