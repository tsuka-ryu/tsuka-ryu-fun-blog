import { Seo } from "#components/Seo.js";
import { getAllTags } from "#content.js";

// `/tags` — 全タグと記事数の一覧。
export function TagsPage() {
  const tags = getAllTags();

  return (
    <div className="page tags-page">
      <Seo
        title="タグ一覧"
        description="記事のタグ一覧。タグをクリックすると、そのタグが付いた記事を絞り込めます。"
        path="/tags"
      />
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
