import { NotFound } from "#components/NotFound.js";
import { Page } from "#components/Page.js";
import { PostCard } from "#components/PostCard.js";

import SearchBox from "../../src/components/SearchBox.tsx" with { island: "load" };

import type { Props } from "./[slug].server.ts";

function TagPage({ tag, posts }: Props) {
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

// ヘッダーの検索欄は、このファイルでアイランドにして渡す（理由は #components/Page.js）。
export default function TagPageWithFrame(props: React.ComponentProps<typeof TagPage>) {
  return (
    <Page search={<SearchBox />}>
      <TagPage {...props} />
    </Page>
  );
}
