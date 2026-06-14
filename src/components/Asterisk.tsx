// 手描き風アスタリスク（✳）。3 本の線をわずかに非対称にして、機械的でない表情を出す。
// ブランド名の脇・ヒーロー見出し・記事一覧のシーン区切りで使い回す装飾記号。
// 純粋な飾りなので支援技術には読み上げさせない（aria-hidden）。
export function Asterisk({ className }: { className?: string }) {
  return (
    <span className={className ? `ast ${className}` : "ast"} aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
        >
          <path d="M12 3.2 L12 20.8" />
          <path d="M4.4 7 L19.4 17.4" />
          <path d="M19.6 6.6 L4.6 17.2" />
        </g>
      </svg>
    </span>
  );
}

// 本の「* * *」のようなシーン区切り。罫線の代わりに ✳ を 3 つ並べ、余白で区切る。
// セクションの頭や記事グループの境目に置く。
export function SceneBreak() {
  return (
    <div className="rule" aria-hidden="true">
      <Asterisk />
      <Asterisk />
      <Asterisk />
    </div>
  );
}
