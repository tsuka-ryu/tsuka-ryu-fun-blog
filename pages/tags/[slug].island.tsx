import { NotFound } from "#components/NotFound.js";
import { PostCard } from "#components/PostCard.js";

import type { Props } from "./[slug].server.ts";

export default function TagPage({ tag, posts }: Props) {
  if (tag === null) return <NotFound />;

  return (
    <div className="page tag-page">
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
