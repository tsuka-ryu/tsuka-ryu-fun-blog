import type { TocEntry } from "#lib/toc.js";

// 記事の目次。extractToc が見出しに振った id へのアンカーリンクだけで構成し、
// クライアント JS は不要。インデントは見出しの深さ（depth）で表現する。
export function PostToc({ toc }: { toc: TocEntry[] }) {
  if (toc.length === 0) return null;

  // 目次内の最小 depth を 0 起点に揃え、相対的な階層でインデントする。
  const minDepth = Math.min(...toc.map((entry) => entry.depth));

  // 折りたたみ式（<details>）。既定は閉じておき、タグの下で邪魔にならないようにする。
  // summary が開閉トグルを兼ねる。アンカーリンクだけなのでクライアント JS は不要。
  return (
    <details className="post-toc">
      <summary className="post-toc-title">目次</summary>
      <ul className="post-toc-list" aria-label="目次">
        {toc.map((entry) => (
          <li key={entry.id} className="post-toc-item" data-depth={entry.depth - minDepth}>
            <a href={`#${entry.id}`}>{entry.text}</a>
          </li>
        ))}
      </ul>
    </details>
  );
}
