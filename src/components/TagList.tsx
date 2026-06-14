import { tagSlug } from "#content.js";

// 記事のタグを `/tags/<slug>` へのピル状リンクとして並べる。タグが無ければ何も
// 描画しない。ホーム・記事ページ・タグページから共有して使う。
export function TagList({ tags }: { tags?: string[] }) {
  if (!tags || tags.length === 0) return null;

  return (
    <ul className="tag-list" aria-label="タグ">
      {tags.map((tag) => (
        <li key={tag}>
          <a href={`/tags/${tagSlug(tag)}`} className="tag">
            {tag}
          </a>
        </li>
      ))}
    </ul>
  );
}
