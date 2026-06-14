import type { TocEntry } from "#lib/toc.js";

// 記事の目次。extractToc が見出しに振った id へのアンカーリンクだけで構成し、
// クライアント JS は不要。インデントは見出しの深さ（depth）で表現する。
export function PostToc({ toc }: { toc: TocEntry[] }) {
  if (toc.length === 0) return null;

  // 目次内の最小 depth を 0 起点に揃え、相対的な階層でインデントする。
  const minDepth = Math.min(...toc.map((entry) => entry.depth));

  return (
    <nav className="post-toc" aria-label="目次">
      <p className="post-toc-title">目次</p>
      <ul className="post-toc-list">
        {toc.map((entry) => (
          <li
            key={entry.id}
            className="post-toc-item"
            data-depth={entry.depth - minDepth}
          >
            <a href={`#${entry.id}`}>{entry.text}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
