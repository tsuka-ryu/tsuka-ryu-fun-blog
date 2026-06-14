import type { Post } from "#content.js";
import { formatDate } from "#lib/time.js";
import { TagList } from "#components/TagList.js";

// 記事のサマリーカード。ホームページとタグページで共有する。
export function PostCard({ post }: { post: Post }) {
  return (
    <article className="post-card">
      <a href={`/posts/${post.slug}`} className="post-card-link">
        <h2 className="post-card-title">{post.frontmatter.title}</h2>
      </a>
      <p className="post-meta">
        <time dateTime={post.frontmatter.date}>
          {formatDate(post.frontmatter.date)}
        </time>
      </p>
      {post.frontmatter.description && (
        <p className="post-card-excerpt">{post.frontmatter.description}</p>
      )}
      <TagList tags={post.frontmatter.tags} />
    </article>
  );
}
