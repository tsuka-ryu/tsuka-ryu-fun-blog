import { NotFound } from "#components/NotFound.js";
import { PostToc } from "#components/PostToc.js";
import { TagList } from "#components/TagList.js";
import { formatDate } from "#lib/time.js";
import { Markdown } from "#markdown/index.js";

import type { Props } from "./[slug].server.ts";

export default function PostPage({ post }: Props) {
  if (!post) return <NotFound />;

  return (
    <div className="post-layout">
      <article className="post-page">
        <header className="post-header">
          <h1 className="post-title">{post.frontmatter.title}</h1>
          <p className="post-meta">
            <time dateTime={post.frontmatter.date}>{formatDate(post.frontmatter.date)}</time>
          </p>
          <TagList tags={post.frontmatter.tags} />
        </header>

        {/* 目次はタグの直後に折りたたみで置く。広い画面では sticky な右カラムへ
            移す（.post-page を display:contents にしてグリッド項目化する）。 */}
        <PostToc toc={post.toc} />

        {/* AST は、コードのハイライトまで済ませた状態で loader から届く。
            dangerouslySetInnerHTML 不要・ページに JavaScript は載らない（アイランドではない）。 */}
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
