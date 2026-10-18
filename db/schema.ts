import { sql } from "void/db";
import { index, integer, sqliteTable, text, uniqueIndex } from "void/schema-d1";

const now = sql`(datetime('now'))`;

/**
 * 公開中の版。管理画面の記事一覧はここだけを軽く引く。
 * 一度も公開していない記事は `publishedRevisionId` が NULL。
 * 読者向けの公開ページは D1 を読まず、公開時に書き出した R2 のスナップショットを読む。
 */
export const posts = sqliteTable(
  "posts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    /** 記事の日付（`YYYY-MM-DD`）。公開日ではなく、記事に表示する日付。 */
    date: text("date").notNull(),
    /** 公開した版の `post_revisions.id`。循環参照を避けるため外部キーにはしない。 */
    publishedRevisionId: integer("published_revision_id"),
    publishedAt: text("published_at"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [uniqueIndex("posts_slug_unique").on(t.slug)],
);

/**
 * 編集中の下書きと履歴。
 * - `draft`: 記事ごとに 1 行だけ。自動保存はこの行を上書きする。
 * - `snapshot`: 一定時間ごとの版。件数上限を超えたら古い順に消す。
 * - `published`: 公開時の版。別枠で保持し、件数上限の削除対象にしない。
 */
export const postRevisions = sqliteTable(
  "post_revisions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    postId: integer("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["draft", "snapshot", "published"] }).notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    date: text("date").notNull(),
    /** タグ名の配列（JSON 文字列）。公開時に `post_tags` へ反映する。 */
    tags: text("tags").notNull().default("[]"),
    /** frontmatter を含まない本文の Markdown。 */
    body: text("body").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  // 履歴一覧は本文を引かず、記事・種別・新しい順で引く。
  (t) => [index("post_revisions_post_kind_created").on(t.postId, t.kind, t.createdAt)],
);

export const tags = sqliteTable(
  "tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    /** URL に使う表記。transliteration で生成し、現行のタグ URL と互換にする。 */
    slug: text("slug").notNull(),
  },
  (t) => [uniqueIndex("tags_name_unique").on(t.name), uniqueIndex("tags_slug_unique").on(t.slug)],
);

/** 公開中の版に付いているタグ。 */
export const postTags = sqliteTable(
  "post_tags",
  {
    postId: integer("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("post_tags_unique").on(t.postId, t.tagId),
    index("post_tags_tag").on(t.tagId),
  ],
);

/** R2 にアップロードした画像。記事を消してもファイルは残す（`postId` は NULL になる）。 */
export const assets = sqliteTable(
  "assets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    r2Key: text("r2_key").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    postId: integer("post_id").references(() => posts.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("assets_r2_key_unique").on(t.r2Key)],
);
