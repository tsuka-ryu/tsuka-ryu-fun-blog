import { tagSlug } from "#lib/tag-slug.js";
import { revisionTags, type PostInput } from "#site/build.js";
import { and, asc, desc, eq, inArray } from "void/db";

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
export async function saveDraft(db: Db, input: PostInput, now: Date): Promise<PostRow> {
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
  return (await getPostBySlug(db, input.slug))!;
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
