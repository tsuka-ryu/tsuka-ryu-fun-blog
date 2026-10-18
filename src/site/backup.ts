import { assets, postRevisions, posts, postTags, tags } from "../../db/schema.ts";

import type { Db } from "#site/posts.js";

// D1 のブログのデータ（記事・履歴・タグ・画像の管理表）の書き出しと復元。
// 認証のテーブル（ユーザー・セッション）は含めない（GitHub でログインし直せば作られる）。
// 公開済みの記事の原文（.md）は、R2 にもある（公開のたびに書く）ので、書き出しは「下書き・履歴・公開の状態」を
// 守るためのもの。

export interface Backup {
  version: 1;
  exportedAt: string;
  posts: Array<typeof posts.$inferSelect>;
  revisions: Array<typeof postRevisions.$inferSelect>;
  tags: Array<typeof tags.$inferSelect>;
  postTags: Array<typeof postTags.$inferSelect>;
  assets: Array<typeof assets.$inferSelect>;
}

/** 全データを書き出す（管理者だけが、たまに行う操作。全件を読むので、公開側からは呼ばない）。 */
export async function exportBackup(db: Db, now: Date): Promise<Backup> {
  const [postRows, revisionRows, tagRows, postTagRows, assetRows] = await Promise.all([
    db.select().from(posts),
    db.select().from(postRevisions),
    db.select().from(tags),
    db.select().from(postTags),
    db.select().from(assets),
  ]);
  return {
    version: 1,
    exportedAt: now.toISOString(),
    posts: postRows,
    revisions: revisionRows,
    tags: tagRows,
    postTags: postTagRows,
    assets: assetRows,
  };
}

export class BackupError extends Error {}

/** D1 は 1 回のクエリに束縛できる値が 100 個までなので、列数から 1 回に入れる行数を決める。 */
const MAX_PARAMS = 90;

function chunks<T>(rows: readonly T[], columns: number): T[][] {
  const size = Math.max(1, Math.floor(MAX_PARAMS / columns));
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

function isBackup(value: unknown): value is Backup {
  const backup = value as Partial<Backup> | null;
  return (
    backup?.version === 1 &&
    Array.isArray(backup.posts) &&
    Array.isArray(backup.revisions) &&
    Array.isArray(backup.tags) &&
    Array.isArray(backup.postTags) &&
    Array.isArray(backup.assets)
  );
}

/**
 * 書き出したデータを、**空の** D1 に戻す（id もそのまま）。記事が 1 件でもあれば、上書きして壊さないよう拒否する。
 * 戻したあとは、`republishAll` で R2 の公開スナップショットを作り直す。
 */
export async function restoreBackup(
  db: Db,
  backup: unknown,
): Promise<{ posts: number; revisions: number; tags: number; assets: number }> {
  if (!isBackup(backup))
    throw new BackupError("書き出しの形式が正しくありません（version 1 のみ対応）");
  const [existing] = await db.select({ id: posts.id }).from(posts).limit(1);
  if (existing)
    throw new BackupError("記事がすでにあるので、戻せません（空のデータベースにだけ戻せます）");

  // 外部キーの順（記事 → 履歴・タグ → 紐付け・画像）に入れる。
  const steps: Array<[readonly object[], number, (rows: never[]) => PromiseLike<unknown>]> = [
    [backup.posts, 9, (rows) => db.insert(posts).values(rows)],
    [backup.revisions, 9, (rows) => db.insert(postRevisions).values(rows)],
    [backup.tags, 3, (rows) => db.insert(tags).values(rows)],
    [backup.postTags, 2, (rows) => db.insert(postTags).values(rows)],
    [backup.assets, 6, (rows) => db.insert(assets).values(rows)],
  ];
  for (const [rows, columns, insert] of steps) {
    for (const group of chunks(rows, columns)) await insert(group as never[]);
  }
  return {
    posts: backup.posts.length,
    revisions: backup.revisions.length,
    tags: backup.tags.length,
    assets: backup.assets.length,
  };
}
