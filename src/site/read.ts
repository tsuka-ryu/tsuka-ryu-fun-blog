import { buildAggregates } from "#site/build.js";
import {
  FEED_KEY,
  INDEX_KEY,
  SEARCH_INDEX_KEY,
  SITEMAP_KEY,
  postJsonKey,
  postMarkdownKey,
} from "#site/keys.js";

import type { Post, SiteIndex } from "#content.js";
import type { ObjectStore } from "#site/store.js";

// 公開側（読者のリクエスト）が、R2 のスナップショットを読む処理。
// ここと、ここから呼ばれるファイルは、D1 に触れてはいけない（`public-boundary.test.ts` が守る）。

/** 公開側が受け付ける slug。R2 のキーに使うので、`/` や `..` を通さない。 */
const PUBLIC_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** まだ何も公開していないときの、空の集計物。 */
function emptyAggregates() {
  return buildAggregates([], new Date());
}

export async function readIndex(store: ObjectStore): Promise<SiteIndex> {
  const json = await store.get(INDEX_KEY);
  return json ? (JSON.parse(json) as SiteIndex) : emptyAggregates().index;
}

export async function readPost(store: ObjectStore, slug: string): Promise<Post | null> {
  if (!PUBLIC_SLUG.test(slug)) return null;
  const json = await store.get(postJsonKey(slug));
  return json ? (JSON.parse(json) as Post) : null;
}

/** `/posts/<slug>.md` で返す原文。なければ null。 */
export async function readPostMarkdown(store: ObjectStore, slug: string): Promise<string | null> {
  if (!PUBLIC_SLUG.test(slug)) return null;
  return store.get(postMarkdownKey(slug));
}

export async function readFeed(store: ObjectStore): Promise<string> {
  return (await store.get(FEED_KEY)) ?? emptyAggregates().feedXml;
}

export async function readSitemap(store: ObjectStore): Promise<string> {
  return (await store.get(SITEMAP_KEY)) ?? emptyAggregates().sitemapXml;
}

export async function readSearchIndex(store: ObjectStore): Promise<string> {
  return (await store.get(SEARCH_INDEX_KEY)) ?? emptyAggregates().searchIndexJson;
}
