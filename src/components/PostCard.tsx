import { TagList } from "#components/TagList.js";
import { formatDateDots } from "#lib/time.js";

import type { Post } from "#content.js";

// 記事のサマリーカード。ホームページとタグページで共有する。
// 日付を本文の左マージンに逃がし、タイトル・説明・タグを 1 列にまとめる。
export function PostCard({ post }: { post: Post }) {
  return (
    <article className="post-card">
      <time className="post-card-date" dateTime={post.frontmatter.date}>
        {formatDateDots(post.frontmatter.date)}
      </time>
      <div className="post-card-body">
        <a href={`/posts/${post.slug}`} className="post-card-link">
          <h2 className="post-card-title">{post.frontmatter.title}</h2>
        </a>
        {post.frontmatter.description && (
          <p className="post-card-excerpt">{post.frontmatter.description}</p>
        )}
        <TagList tags={post.frontmatter.tags} />
      </div>
    </article>
  );
}
