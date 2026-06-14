import { getPostBySlug } from "#content.js";
import { formatDate } from "#lib/time.js";
import { Markdown } from "#markdown/index.js";
import { Seo } from "#components/Seo.js";
import { PostToc } from "#components/PostToc.js";
import { TagList } from "#components/TagList.js";
import { NotFoundPage } from "#pages/NotFoundPage.js";

// 記事ページ。slug から記事を引き、mdast を <Markdown> で描画する。
export function PostPage({ slug }: { slug: string }) {
  const post = getPostBySlug(slug);

  if (!post) {
    return <NotFoundPage />;
  }

  return (
    <div className="post-layout">
      {/* 目次は DOM 上で先に置き、狭い画面では上部に出す。広い画面では
          グリッドの領域指定で右側の sticky カラムに移す（スタイルはフェーズ8）。 */}
      <PostToc toc={post.toc} />
      <article className="post-page">
        <Seo
          title={post.frontmatter.title}
          description={post.frontmatter.description}
          path={`/posts/${post.slug}`}
          image={`/og/${post.slug}.png`}
          type="article"
        />
        <header className="post-header">
          <h1 className="post-title">{post.frontmatter.title}</h1>
          <p className="post-meta">
            <time dateTime={post.frontmatter.date}>
              {formatDate(post.frontmatter.date)}
            </time>
          </p>
          <TagList tags={post.frontmatter.tags} />
        </header>

        {/* mdast はビルド時に React Server Component へマッピングされる。
            dangerouslySetInnerHTML 不要・Markdown コードはクライアントに載らない。 */}
        <div className="post-body">
          <Markdown root={post.mdast} />
        </div>

        <footer className="post-footer">
          <a href="/" className="back-link">
            &larr; 記事一覧へ戻る
          </a>
        </footer>
      </article>
    </div>
  );
}
