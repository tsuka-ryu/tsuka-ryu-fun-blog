// R2 に置く公開スナップショットのキー。公開側（読む）と公開関数（書く）で同じものを使う。

export const PUBLISHED_PREFIX = "published/";
export const INDEX_KEY = "published/index.json";
export const SEARCH_INDEX_KEY = "published/search-index.json";
export const FEED_KEY = "published/feed.xml";
export const SITEMAP_KEY = "published/sitemap.xml";

/** 記事ごとのスナップショット（パース済み AST と目次を含む JSON）。 */
export const postJsonKey = (slug: string) => `published/posts/${slug}.json`;
/** `/posts/<slug>.md` で配信する原文（frontmatter 付き）。 */
export const postMarkdownKey = (slug: string) => `published/posts/${slug}.md`;

export const POSTS_PREFIX = "published/posts/";

/** 記事の OG 画像（公開時に作る PNG）。`/og/<slug>.png` で配信する。 */
export const ogKey = (slug: string) => `published/og/${slug}.png`;
