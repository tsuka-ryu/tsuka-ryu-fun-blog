import { getAllPosts } from "#content.js";
import { Seo } from "#components/Seo.js";
import { PostCard } from "#components/PostCard.js";
import { Asterisk, SceneBreak } from "#components/Asterisk.js";
import { SITE_CATCHPHRASE, SITE_NAME } from "#constants.js";

// トップページ。名前を大きく出したヒーローと、記事一覧を並べる。
export function HomePage() {
  const posts = getAllPosts();

  return (
    <div className="page home-page">
      <Seo path="/" />
      <section className="hero">
        {/* data-text は :hover 時のグリッチ用の複製テキスト（styles.css の .glitch）。 */}
        <h1>
          <span className="glitch" data-text={SITE_NAME}>
            {SITE_NAME}
          </span>
          <Asterisk />
        </h1>
        <p className="hero-tagline">{SITE_CATCHPHRASE}</p>
      </section>

      <SceneBreak />

      <section className="post-list">
        {posts.map((post) => (
          <PostCard key={post.slug} post={post} />
        ))}
      </section>
    </div>
  );
}
