import { getAllPosts } from "#content.js";
import { Seo } from "#components/Seo.js";
import { PostCard } from "#components/PostCard.js";
import { SearchBox } from "#components/SearchBox.js";
import { SITE_DESCRIPTION, SITE_TITLE } from "#constants.js";

// トップページ。サイト紹介・検索ボックス・記事一覧を並べる。
export function HomePage() {
  const posts = getAllPosts();

  return (
    <div className="page home-page">
      <Seo path="/" />
      <section className="intro">
        <h1>{SITE_TITLE}</h1>
        <p className="tagline">{SITE_DESCRIPTION}</p>
        <p className="intro-links">
          <a href="/tags">タグ一覧 →</a>
        </p>
        <SearchBox />
      </section>

      <section className="post-list">
        {posts.map((post) => (
          <PostCard key={post.slug} post={post} />
        ))}
      </section>
    </div>
  );
}
