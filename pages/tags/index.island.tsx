import type { Props } from "./index.server.ts";

export default function TagsPage({ tags }: Props) {
  return (
    <div className="page tags-page">
      <h1>タグ一覧</h1>
      {tags.length === 0 ? (
        <p className="tagline">まだタグがありません。</p>
      ) : (
        <ul className="tag-cloud" aria-label="タグ一覧">
          {tags.map((t) => (
            <li key={t.slug}>
              <a href={`/tags/${t.slug}`} className="tag">
                {t.tag}
                <span className="tag-count">{t.count}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
