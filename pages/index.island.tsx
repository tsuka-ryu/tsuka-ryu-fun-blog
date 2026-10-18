import { Asterisk, SceneBreak } from "#components/Asterisk.js";
import { Page } from "#components/Page.js";
import { PostCard } from "#components/PostCard.js";
import { SITE_CATCHPHRASE, SITE_NAME } from "#constants.js";

import SearchBox from "../src/components/SearchBox.tsx" with { island: "load" };

import type { Props } from "./index.server.ts";

function HomePage({ posts }: Props) {
  return (
    <div className="page home-page">
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

// ヘッダーの検索欄は、このファイルでアイランドにして渡す（理由は #components/Page.js）。
export default function HomePageWithFrame(props: React.ComponentProps<typeof HomePage>) {
  return (
    <Page search={<SearchBox />}>
      <HomePage {...props} />
    </Page>
  );
}
