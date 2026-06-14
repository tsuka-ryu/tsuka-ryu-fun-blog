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

        {/* 目次はタグの直後に折りたたみで置く。広い画面では sticky な右カラムへ
            移す（.post-page を display:contents にしてグリッド項目化する）。 */}
        <PostToc toc={post.toc} />

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
