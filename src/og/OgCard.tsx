// Open Graph カード。ビルド時に Takumi が 1200×630 の PNG に描画する（src/lib/og.ts）。
// これは DOM / RSC コンポーネントではなく、Takumi が要素ツリーを satori 風に解釈する。
// そのため複数子を持つボックスはすべて display: flex を指定し、テキストは同梱の
// "Noto Sans JP" フォントを使う。
export interface OgCardProps {
  /** タイトルの上に表示するサイト名。 */
  siteName: string;
  /** 記事タイトル（主役のテキスト）。 */
  title: string;
  /** 補助行。例: "react · ssg · 2026年6月7日"。 */
  meta?: string;
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
        padding: "72px",
        backgroundColor: "#0d1117",
        color: "#e6edf3",
        fontFamily: "Noto Sans JP",
      }}
    >
      <div style={{ display: "flex", color: "#a78bfa", fontSize: "34px" }}>
        {siteName}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: "68px",
          lineHeight: 1.25,
          // 上下のサイト名 / メタ行ぶんの余白を確保する。
          maxHeight: "360px",
          overflow: "hidden",
        }}
      >
        {title}
      </div>
      <div style={{ display: "flex", color: "#9198a1", fontSize: "28px" }}>
        {meta ?? ""}
      </div>
    </div>
  );
}
