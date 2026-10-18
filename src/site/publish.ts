import { tagSlug } from "#lib/tag-slug.js";
import { buildAggregates, buildPost, revisionTags } from "#site/build.js";
import {
  FEED_KEY,
  INDEX_KEY,
  POSTS_PREFIX,
  SEARCH_INDEX_KEY,
  SITEMAP_KEY,
  postJsonKey,
  postMarkdownKey,
} from "#site/keys.js";
import {
  deletePostRow,
  deleteUnusedTags,
  findPostsWithTag,
  ensurePublishedRevision,
  getDraft,
  getPostBySlug,
  getPublishedRevision,
  markPublished,
  markUnpublished,
  revisionToInput,
  type Db,
  type PostRow,
  type RevisionRow,
} from "#site/posts.js";
import { eq } from "void/db";

import { postRevisions, tags } from "../../db/schema.ts";

import type { Post } from "#content.js";
import type { Diagnostic } from "#markdown/parse/index.js";
import type { ObjectStore } from "#site/store.js";

// 公開操作。D1（編集用の正）と R2（読者が見るスナップショット）と ISR のキャッシュを、1 つの関数で更新する。
//
// 順序は「R2 → D1 → 集計物の作り直し → ISR 無効化」。読者が見るのは R2 なので、R2 を先に書く
// （逆順だと、管理画面では公開済みなのに読者には届いていない状態を作る）。どこで失敗しても、同じ操作を
// もう一度実行すれば収束する（R2 は上書き、公開版の履歴は内容が同じなら再利用、集計物は毎回作り直す）。
// 取り下げは逆順の考え方で、R2 を消してから D1 を更新する。

export interface PublishDeps {
  db: Db;
  store: ObjectStore;
  /** ISR のキャッシュを無効化する（本番は void/isr の `revalidate({ paths })`）。 */
  revalidate: (paths: string[]) => Promise<void>;
  now: () => Date;
}

export type PublishResult =
  | {
      ok: true;
      warnings: Diagnostic[];
      /** ISR の無効化に失敗したとき、その内容。公開自体は済んでいるので、もう一度実行すれば直る。 */
      revalidateError?: string;
    }
  | { ok: false; reason: "not_found" | "no_draft" }
  | { ok: false; reason: "invalid"; errors: Diagnostic[] };

/** 公開中の全記事（R2 のスナップショット）を読む。 */
async function readPublishedPosts(store: ObjectStore): Promise<Post[]> {
  const keys = (await store.list(POSTS_PREFIX)).filter((key) => key.endsWith(".json"));
  const loaded = await Promise.all(keys.map((key) => store.get(key)));
  return loaded.flatMap((json) => (json ? [JSON.parse(json) as Post] : []));
}

/**
 * 一覧・feed・sitemap・検索索引を、公開中の全記事から作り直して R2 に書く。冪等。
 * 返り値は、この時点で公開されているタグのスラッグ（ISR の無効化の対象を決めるのに使う）。
 */
export async function rebuildAggregates(deps: Pick<PublishDeps, "store" | "now">) {
  const posts = await readPublishedPosts(deps.store);
  const { index, feedXml, sitemapXml, searchIndexJson } = buildAggregates(posts, deps.now());
  const { store } = deps;
  await Promise.all([
    store.put(INDEX_KEY, JSON.stringify(index), "application/json; charset=utf-8"),
    store.put(SEARCH_INDEX_KEY, searchIndexJson, "application/json; charset=utf-8"),
    store.put(FEED_KEY, feedXml, "application/rss+xml; charset=utf-8"),
    store.put(SITEMAP_KEY, sitemapXml, "application/xml; charset=utf-8"),
  ]);
  return index;
}

/** 記事の公開・更新・取り下げで、キャッシュを捨てるべきパス。 */
function affectedPaths(slug: string, tagNames: Iterable<string>): string[] {
  const tagPaths = [...new Set([...tagNames].map((tag) => tagSlug(tag)))].map(
    (slug) => `/tags/${slug}`,
  );
  return [
    "/",
    `/posts/${slug}`,
    `/posts/${slug}.md`,
    "/tags",
    ...tagPaths,
    "/feed.xml",
    "/sitemap.xml",
    "/search-index.json",
  ];
}

async function invalidate(deps: PublishDeps, paths: string[]): Promise<string | undefined> {
  try {
    await deps.revalidate(paths);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** 下書きを検証して公開する（すでに公開中なら、公開中の版を下書きの内容で更新する）。 */
export async function publishPost(deps: PublishDeps, slug: string): Promise<PublishResult> {
  const post = await getPostBySlug(deps.db, slug);
  if (!post) return { ok: false, reason: "not_found" };
  const draft = await getDraft(deps.db, post.id);
  if (!draft) return { ok: false, reason: "no_draft" };
  return publishFrom(deps, post, draft);
}

/** `source`（下書き、またはそのコピー）の内容を、公開中の版にする。 */
async function publishFrom(
  deps: PublishDeps,
  post: PostRow,
  source: RevisionRow,
): Promise<PublishResult> {
  const { db, store } = deps;
  const slug = post.slug;

  // 1. 検証（error が 1 つでもあれば、何も書かずに失敗する）。
  const built = await buildPost(revisionToInput(slug, source));
  if (!built.ok) return { ok: false, reason: "invalid", errors: built.errors };

  const before = await getPublishedRevision(db, post);

  // 2. R2 に、記事のスナップショットと原文を書く（読者に見えるのはここから）。
  await Promise.all([
    store.put(postJsonKey(slug), JSON.stringify(built.post), "application/json; charset=utf-8"),
    store.put(postMarkdownKey(slug), built.raw, "text/markdown; charset=utf-8"),
  ]);

  // 3. D1 を更新する（公開版の履歴を追加し、`posts` と `post_tags` を公開した版に合わせる）。
  const now = deps.now();
  const revisionId = await ensurePublishedRevision(db, post, source, now);
  await markPublished(db, post, revisionId, source, now);

  // 4. 一覧・feed・sitemap・検索索引を作り直し、5. キャッシュを無効化する。
  await rebuildAggregates(deps);
  const revalidateError = await invalidate(
    deps,
    affectedPaths(slug, [...revisionTags(source), ...(before ? revisionTags(before) : [])]),
  );
  return { ok: true, warnings: built.warnings, ...(revalidateError ? { revalidateError } : {}) };
}

/** 公開を取り下げる。下書きと履歴は残す（もう一度公開できる）。公開していない記事なら何もしない。 */
export async function unpublishPost(deps: PublishDeps, slug: string): Promise<PublishResult> {
  const { db, store } = deps;
  const post = await getPostBySlug(db, slug);
  if (!post) return { ok: false, reason: "not_found" };
  const before = await getPublishedRevision(db, post);

  // R2 を先に消す（読者に見えなくなるのはここから）。D1 の更新が失敗しても、もう一度実行すれば直る。
  await Promise.all([store.delete(postJsonKey(slug)), store.delete(postMarkdownKey(slug))]);
  if (post.publishedRevisionId !== null) await markUnpublished(db, post, deps.now());

  await rebuildAggregates(deps);
  const revalidateError = await invalidate(
    deps,
    affectedPaths(slug, before ? revisionTags(before) : []),
  );
  return { ok: true, warnings: [], ...(revalidateError ? { revalidateError } : {}) };
}

/** 記事を完全に消す（公開中なら取り下げてから、D1 の行と履歴を消す）。 */
export async function deletePost(deps: PublishDeps, slug: string): Promise<PublishResult> {
  const result = await unpublishPost(deps, slug);
  if (!result.ok) return result;
  const post = await getPostBySlug(deps.db, slug);
  if (post) await deletePostRow(deps.db, post);
  return result;
}

export interface RenameTagResult {
  /** タグを付け替えた記事の slug。 */
  renamed: string[];
  /** 公開し直しに失敗した記事（検証に通らなくなったなど）。 */
  failed: Array<{ slug: string; reason: string }>;
}

/**
 * タグ名を一括で変更する（表記ゆれの統一にも使う。`to` がすでにあるタグなら、そちらに統合される）。
 * 下書きと公開中の版の両方のタグを付け替え、公開中の記事は、**公開中の版の内容のまま**（下書きの未公開の変更は
 * 載せずに）公開し直す。
 */
export async function renameTag(
  deps: PublishDeps,
  from: string,
  to: string,
): Promise<RenameTagResult> {
  const result: RenameTagResult = { renamed: [], failed: [] };
  const target = to.trim();
  if (!target || target === from) return result;
  const replace = (names: string[]) => [
    ...new Set(names.map((name) => (name === from ? target : name))),
  ];

  for (const post of await findPostsWithTag(deps.db, from)) {
    const draft = await getDraft(deps.db, post.id);
    if (draft && revisionTags(draft).includes(from)) {
      await deps.db
        .update(postRevisions)
        .set({ tags: JSON.stringify(replace(revisionTags(draft))) })
        .where(eq(postRevisions.id, draft.id));
    }
    const published = await getPublishedRevision(deps.db, post);
    if (published && revisionTags(published).includes(from)) {
      const source = { ...published, tags: JSON.stringify(replace(revisionTags(published))) };
      const outcome = await publishFrom(deps, post, source);
      if (!outcome.ok) {
        result.failed.push({ slug: post.slug, reason: outcome.reason });
        continue;
      }
    }
    result.renamed.push(post.slug);
  }
  // 同じスラッグのタグがすでにあると、その表示名が残るので、変更後の表記に揃える。
  await deps.db
    .update(tags)
    .set({ name: target })
    .where(eq(tags.slug, tagSlug(target)));
  await deleteUnusedTags(deps.db);
  return result;
}
