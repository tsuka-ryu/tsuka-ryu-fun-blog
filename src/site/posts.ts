import { tagSlug } from "#lib/tag-slug.js";
import { revisionTags, type PostInput } from "#site/build.js";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "void/db";

import { postRevisions, posts, postTags, tags } from "../../db/schema.ts";

import type { createDb } from "void/db";

// 記事の編集用データ（D1）の読み書き。公開側（読者のリクエスト）からは呼ばない。
// すべてのクエリは索引に乗せ、一覧は本文を引かない。

export type Db = ReturnType<typeof createDb>;

export type PostRow = typeof posts.$inferSelect;
export type RevisionRow = typeof postRevisions.$inferSelect;

/** slug は URL と R2 のキーになるので、小文字の英数字とハイフンだけにする。 */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return slug.length <= 100 && SLUG_PATTERN.test(slug);
}

export function revisionToInput(slug: string, revision: RevisionRow): PostInput {
  return {
    slug,
    title: revision.title,
    description: revision.description,
    date: revision.date,
    tags: revisionTags(revision),
    body: revision.body,
  };
}

export async function getPostBySlug(db: Db, slug: string): Promise<PostRow | undefined> {
  const [row] = await db.select().from(posts).where(eq(posts.slug, slug)).limit(1);
  return row;
}

/** 記事の下書き（`kind = draft` は記事ごとに 1 行）。 */
export async function getDraft(db: Db, postId: number): Promise<RevisionRow | undefined> {
  const [row] = await db
    .select()
    .from(postRevisions)
    .where(and(eq(postRevisions.postId, postId), eq(postRevisions.kind, "draft")))
    .limit(1);
  return row;
}

/** 公開中の版（`posts.publishedRevisionId`）。公開していなければ undefined。 */
export async function getPublishedRevision(
  db: Db,
  post: PostRow,
): Promise<RevisionRow | undefined> {
  if (post.publishedRevisionId === null) return undefined;
  const [row] = await db
    .select()
    .from(postRevisions)
    .where(eq(postRevisions.id, post.publishedRevisionId))
    .limit(1);
  return row;
}

/**
 * 下書きを保存する（記事がなければ作る）。自動保存はこれを呼ぶ。下書きの行は上書きし、履歴は増やさない。
 * まだ一度も公開していない記事は、一覧に出るタイトルなども下書きに合わせる。
 */
export async function saveDraft(
  db: Db,
  input: PostInput,
  now: Date,
  options: { snapshotIntervalMs?: number; maxSnapshots?: number } = {},
): Promise<PostRow> {
  if (!isValidSlug(input.slug)) {
    throw new Error(`slug は小文字の英数字とハイフンだけで書いてください: ${input.slug}`);
  }
  const at = now.toISOString();
  let post = await getPostBySlug(db, input.slug);
  if (!post) {
    await db
      .insert(posts)
      .values({
        slug: input.slug,
        title: input.title,
        description: input.description,
        date: input.date,
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoNothing();
    post = await getPostBySlug(db, input.slug);
  }
  if (!post) throw new Error(`記事を作れませんでした: ${input.slug}`);

  const fields = {
    title: input.title,
    description: input.description,
    date: input.date,
    tags: JSON.stringify(input.tags),
    body: input.body,
    createdAt: at,
  };
  const draft = await getDraft(db, post.id);
  const changed =
    !draft ||
    draft.title !== fields.title ||
    draft.description !== fields.description ||
    draft.date !== fields.date ||
    draft.tags !== fields.tags ||
    draft.body !== fields.body;
  const writes = [
    draft
      ? db.update(postRevisions).set(fields).where(eq(postRevisions.id, draft.id))
      : db.insert(postRevisions).values({ postId: post.id, kind: "draft", ...fields }),
  ] as const;
  if (post.publishedRevisionId === null) {
    await db.batch([
      ...writes,
      db
        .update(posts)
        .set({
          title: input.title,
          description: input.description,
          date: input.date,
          updatedAt: at,
        })
        .where(eq(posts.id, post.id)),
    ]);
  } else {
    await db.batch([
      ...writes,
      db.update(posts).set({ updatedAt: at }).where(eq(posts.id, post.id)),
    ]);
  }
  if (changed) await recordSnapshot(db, post.id, fields, now, options);
  return (await getPostBySlug(db, input.slug))!;
}

const DEFAULT_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_SNAPSHOTS = 50;

/**
 * 一定時間ごとの版（`snapshot`）を残す。自動保存のたびに履歴が増えないよう、前の版からの間隔を空け、
 * 件数の上限を超えたら古い順に消す。公開版（`published`）は別枠なので消さない。
 */
async function recordSnapshot(
  db: Db,
  postId: number,
  fields: Omit<typeof postRevisions.$inferInsert, "postId" | "kind" | "id">,
  now: Date,
  { snapshotIntervalMs = DEFAULT_SNAPSHOT_INTERVAL_MS, maxSnapshots = DEFAULT_MAX_SNAPSHOTS } = {},
): Promise<void> {
  const [latest] = await db
    .select({ createdAt: postRevisions.createdAt })
    .from(postRevisions)
    .where(and(eq(postRevisions.postId, postId), eq(postRevisions.kind, "snapshot")))
    .orderBy(desc(postRevisions.id))
    .limit(1);
  if (latest && now.getTime() - Date.parse(latest.createdAt) < snapshotIntervalMs) return;

  await db.insert(postRevisions).values({ ...fields, postId, kind: "snapshot" });
  const old = await db
    .select({ id: postRevisions.id })
    .from(postRevisions)
    .where(and(eq(postRevisions.postId, postId), eq(postRevisions.kind, "snapshot")))
    .orderBy(desc(postRevisions.id))
    .limit(1000)
    .offset(maxSnapshots);
  if (old.length > 0) {
    await db.delete(postRevisions).where(
      inArray(
        postRevisions.id,
        old.map((row) => row.id),
      ),
    );
  }
}

/** 履歴の一覧（本文を引かない）。新しい順。 */
export async function listRevisions(db: Db, postId: number, limit = 100) {
  return db
    .select({
      id: postRevisions.id,
      kind: postRevisions.kind,
      title: postRevisions.title,
      createdAt: postRevisions.createdAt,
    })
    .from(postRevisions)
    .where(eq(postRevisions.postId, postId))
    .orderBy(desc(postRevisions.id))
    .limit(limit);
}

export async function getRevision(
  db: Db,
  postId: number,
  revisionId: number,
): Promise<RevisionRow | undefined> {
  const [row] = await db
    .select()
    .from(postRevisions)
    .where(and(eq(postRevisions.postId, postId), eq(postRevisions.id, revisionId)))
    .limit(1);
  return row;
}

/**
 * 過去の版を下書きに戻す。戻す前の下書きは、巻き戻しを取り消せるよう、必ず履歴（snapshot）に残す。
 * 公開中の版には触れない（公開し直すまで、読者には見えない）。
 */
export async function restoreRevision(
  db: Db,
  post: PostRow,
  revisionId: number,
  now: Date,
): Promise<boolean> {
  const target = await getRevision(db, post.id, revisionId);
  if (!target) return false;
  const draft = await getDraft(db, post.id);
  if (draft) {
    await db.insert(postRevisions).values({
      postId: post.id,
      kind: "snapshot",
      title: draft.title,
      description: draft.description,
      date: draft.date,
      tags: draft.tags,
      body: draft.body,
      createdAt: now.toISOString(),
    });
  }
  await saveDraft(db, revisionToInput(post.slug, target), now, { snapshotIntervalMs: Infinity });
  return true;
}

/** 管理画面のタグ入力の候補。公開中の記事に付いているタグと、その記事数。 */
export async function listTags(db: Db) {
  return db
    .select({ name: tags.name, slug: tags.slug, count: sql<number>`count(${postTags.postId})` })
    .from(tags)
    .leftJoin(postTags, eq(postTags.tagId, tags.id))
    .groupBy(tags.id)
    .orderBy(desc(sql`count(${postTags.postId})`), asc(tags.name));
}

/** 下書きまたは公開版のタグに `name` を含む記事（タグ名の一括変更の対象）。 */
export async function findPostsWithTag(db: Db, name: string) {
  const needle = `%${JSON.stringify(name).replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await db
    .select({ postId: postRevisions.postId })
    .from(postRevisions)
    .where(
      and(
        inArray(postRevisions.kind, ["draft", "published"]),
        sql`${postRevisions.tags} like ${needle} escape '\\'`,
      ),
    )
    .groupBy(postRevisions.postId);
  if (rows.length === 0) return [];
  return db
    .select()
    .from(posts)
    .where(
      inArray(
        posts.id,
        rows.map((row) => row.postId),
      ),
    );
}

/** 内容が同じ公開版が最新にあれば、それを再利用する（再実行で履歴が増えないように）。 */
export async function ensurePublishedRevision(
  db: Db,
  post: PostRow,
  draft: RevisionRow,
  now: Date,
): Promise<number> {
  const [latest] = await db
    .select()
    .from(postRevisions)
    .where(and(eq(postRevisions.postId, post.id), eq(postRevisions.kind, "published")))
    .orderBy(desc(postRevisions.id))
    .limit(1);
  if (
    latest &&
    latest.title === draft.title &&
    latest.description === draft.description &&
    latest.date === draft.date &&
    latest.tags === draft.tags &&
    latest.body === draft.body
  ) {
    return latest.id;
  }
  const [inserted] = await db
    .insert(postRevisions)
    .values({
      postId: post.id,
      kind: "published",
      title: draft.title,
      description: draft.description,
      date: draft.date,
      tags: draft.tags,
      body: draft.body,
      createdAt: now.toISOString(),
    })
    .returning({ id: postRevisions.id });
  return inserted!.id;
}

/** 公開した版に合わせて、`posts` と `post_tags` を更新する。 */
export async function markPublished(
  db: Db,
  post: PostRow,
  revisionId: number,
  revision: RevisionRow,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  const names = revisionTags(revision);
  const wanted = new Map(names.map((name) => [tagSlug(name), name]));

  if (wanted.size > 0) {
    // 同じスラッグのタグが先にあれば、そのまま使う（名前が違っても、URL が同じタグは 1 つにまとめる）。
    await db
      .insert(tags)
      .values([...wanted].map(([slug, name]) => ({ slug, name })))
      .onConflictDoNothing();
  }
  const tagIds =
    wanted.size > 0
      ? await db
          .select({ id: tags.id })
          .from(tags)
          .where(inArray(tags.slug, [...wanted.keys()]))
      : [];

  await db.batch([
    db
      .update(posts)
      .set({
        title: revision.title,
        description: revision.description,
        date: revision.date,
        publishedRevisionId: revisionId,
        publishedAt: post.publishedAt ?? at,
        updatedAt: at,
      })
      .where(eq(posts.id, post.id)),
    db.delete(postTags).where(eq(postTags.postId, post.id)),
    ...(tagIds.length > 0
      ? [db.insert(postTags).values(tagIds.map(({ id }) => ({ postId: post.id, tagId: id })))]
      : []),
  ]);
}

/** 公開を取り下げる（`post_tags` を外し、公開中の版への参照を消す。履歴は残す）。 */
export async function markUnpublished(db: Db, post: PostRow, now: Date): Promise<void> {
  await db.batch([
    db
      .update(posts)
      .set({ publishedRevisionId: null, publishedAt: null, updatedAt: now.toISOString() })
      .where(eq(posts.id, post.id)),
    db.delete(postTags).where(eq(postTags.postId, post.id)),
  ]);
}

/** 記事を完全に消す。履歴とタグの紐付けは連鎖して消える。 */
export async function deletePostRow(db: Db, post: PostRow): Promise<void> {
  await db.delete(posts).where(eq(posts.id, post.id));
}

/** 管理画面の記事一覧。本文を引かず、更新の新しい順に `limit` 件ずつ。 */
export async function listPosts(db: Db, { limit, offset }: { limit: number; offset: number }) {
  return db
    .select({
      slug: posts.slug,
      title: posts.title,
      date: posts.date,
      publishedAt: posts.publishedAt,
      updatedAt: posts.updatedAt,
    })
    .from(posts)
    .orderBy(desc(posts.updatedAt), asc(posts.id))
    .limit(limit)
    .offset(offset);
}

/** どの公開記事にも付いていないタグ（付け替えの結果、使われなくなったもの）を消す。 */
export async function deleteUnusedTags(db: Db): Promise<void> {
  await db.delete(tags).where(sql`${tags.id} not in (select ${postTags.tagId} from ${postTags})`);
}

export interface PostDetail {
  slug: string;
  title: string;
  description: string;
  date: string;
  tags: string[];
  body: string;
  /** 公開中か（一度も公開していない・取り下げた記事は "draft"）。 */
  status: "draft" | "published";
  publishedAt: string | null;
  updatedAt: string;
  /** 公開中の版と、いまの下書きの内容が違うか。 */
  hasUnpublishedChanges: boolean;
}

/** 編集画面が開く記事（下書きの内容と、公開の状態）。記事がなければ null。 */
export async function getPostDetail(db: Db, slug: string): Promise<PostDetail | null> {
  const post = await getPostBySlug(db, slug);
  if (!post) return null;
  const draft = await getDraft(db, post.id);
  if (!draft) return null;
  const published = await getPublishedRevision(db, post);
  return {
    slug,
    title: draft.title,
    description: draft.description,
    date: draft.date,
    tags: revisionTags(draft),
    body: draft.body,
    status: published ? "published" : "draft",
    publishedAt: post.publishedAt,
    updatedAt: post.updatedAt,
    hasUnpublishedChanges:
      !published ||
      published.title !== draft.title ||
      published.description !== draft.description ||
      published.date !== draft.date ||
      published.tags !== draft.tags ||
      published.body !== draft.body,
  };
}

/** 公開中の記事（`posts.publishedRevisionId` がある行）。公開し直しのたびに、全件を読む。 */
export async function listPublishedPosts(db: Db): Promise<PostRow[]> {
  return db.select().from(posts).where(isNotNull(posts.publishedRevisionId)).orderBy(asc(posts.id));
}
