import { getTagBySlug } from "#content.js";
import { Seo } from "#components/Seo.js";
import { PostCard } from "#components/PostCard.js";
import { NotFoundPage } from "#pages/NotFoundPage.js";

// `/tags/<slug>` — 単一タグで絞り込んだ記事一覧。
export function TagPage({ slug }: { slug: string }) {
  const result = getTagBySlug(slug);

  if (!result) {
    return <NotFoundPage />;
  }

  const { tag, posts } = result;

  return (
    <div className="page tag-page">
      <Seo
        title={`タグ: ${tag}`}
        description={`「${tag}」タグが付いた記事一覧（${posts.length} 件）。`}
        path={`/tags/${slug}`}
      />
      <section className="intro">
        <h1>
          タグ: <span className="tag">{tag}</span>
        </h1>
        <p className="tagline">{posts.length} 件の記事</p>
        <p className="intro-links">
          <a href="/tags">← すべてのタグ</a>
        </p>
      </section>

      <section className="post-list">
        {posts.map((post) => (
          <PostCard key={post.slug} post={post} />
        ))}
      </section>
    </div>
  );
}
