import { readdirSync, readFileSync } from "node:fs";

import { BackupError, exportBackup, restoreBackup } from "#site/backup.js";
import { FakeD1 } from "#site/fake-d1.js";
import { INDEX_KEY, ogKey, postJsonKey, postMarkdownKey } from "#site/keys.js";
import { saveDraft, type Db } from "#site/posts.js";
import { publishPost, republishAll, type PublishDeps } from "#site/publish.js";
import { MemoryStore } from "#site/store.js";
import { describe, expect, it } from "vitest";
import { createDb } from "void/db";

import { postRevisions, posts, postTags, tags } from "../../db/schema.ts";

const MIGRATIONS = new URL("../../db/migrations/", import.meta.url);

function setup() {
  const d1 = new FakeD1();
  for (const file of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    d1.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
  }
  const db = createDb(d1 as never) as Db;
  const store = new MemoryStore();
  let clock = Date.UTC(2026, 9, 18);
  const deps: PublishDeps = {
    db,
    store,
    renderOg: async () => Uint8Array.from([1, 2, 3]),
    revalidate: async () => {},
    now: () => new Date((clock += 1000)),
  };
  return { deps, db, store };
}

const input = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  title: `記事 ${slug}`,
  description: "説明",
  date: "2026-10-01",
  tags: ["Git", "雑記"],
  body: "## 見出し\n\n本文\n",
  ...extra,
});

describe("書き出しと復元", () => {
  it("書き出したデータを、空の D1 に、id もそのまま戻せる", async () => {
    const a = setup();
    await saveDraft(a.db, input("one"), a.deps.now());
    await saveDraft(a.db, input("two", { tags: ["Git"] }), a.deps.now());
    await publishPost(a.deps, "one");
    await saveDraft(a.db, input("one", { body: "公開後の編集" }), a.deps.now());
    const backup = await exportBackup(a.db, a.deps.now());
    expect(backup.posts).toHaveLength(2);

    const b = setup();
    const counts = await restoreBackup(b.db, JSON.parse(JSON.stringify(backup)));
    expect(counts).toMatchObject({ posts: 2 });
    expect(await exportBackup(b.db, new Date(backup.exportedAt))).toEqual(backup);
  });

  it("行数が多くても（D1 の束縛上限を超える量でも）戻せる", async () => {
    const a = setup();
    for (let i = 0; i < 35; i++) await saveDraft(a.db, input(`bulk-${i}`), a.deps.now());
    const backup = await exportBackup(a.db, a.deps.now());
    expect(backup.posts).toHaveLength(35);

    const b = setup();
    await restoreBackup(b.db, backup);
    expect(await b.db.select().from(posts)).toHaveLength(35);
    expect(await b.db.select().from(postRevisions)).toHaveLength(backup.revisions.length);
  });

  it("記事がすでにある D1 と、形式の違うデータは、拒否する", async () => {
    const a = setup();
    await saveDraft(a.db, input("one"), a.deps.now());
    const backup = await exportBackup(a.db, a.deps.now());
    await expect(restoreBackup(a.db, backup)).rejects.toBeInstanceOf(BackupError);
    const b = setup();
    await expect(restoreBackup(b.db, { version: 2 })).rejects.toBeInstanceOf(BackupError);
    await expect(restoreBackup(b.db, null)).rejects.toBeInstanceOf(BackupError);
    expect(await b.db.select().from(posts)).toHaveLength(0);
  });
});

describe("republishAll", () => {
  it("D1 を戻したあと、公開中の記事だけを R2 に作り直す（下書きは公開しない）", async () => {
    const a = setup();
    await saveDraft(a.db, input("live"), a.deps.now());
    await saveDraft(a.db, input("draft-only"), a.deps.now());
    await publishPost(a.deps, "live");
    // 公開後の下書きの編集は、公開し直しに載らない。
    await saveDraft(a.db, input("live", { body: "未公開の編集" }), a.deps.now());
    const backup = await exportBackup(a.db, a.deps.now());

    const b = setup();
    await restoreBackup(b.db, backup);
    expect(b.store.objects.size).toBe(0);
    const result = await republishAll(b.deps);
    expect(result).toEqual({ republished: ["live"], failed: [] });

    expect(JSON.parse((await b.store.get(postJsonKey("live")))!).body).toContain("本文");
    expect(JSON.parse((await b.store.get(postJsonKey("live")))!).body).not.toContain("未公開");
    expect(await b.store.get(postMarkdownKey("live"))).toContain("title: 記事 live");
    expect(b.store.objects.has(ogKey("live"))).toBe(true);
    expect(b.store.objects.has(postJsonKey("draft-only"))).toBe(false);
    const index = JSON.parse((await b.store.get(INDEX_KEY))!);
    expect(index.posts.map((p: { slug: string }) => p.slug)).toEqual(["live"]);
    // タグの紐付けも D1 に残っている。
    expect((await b.db.select().from(tags)).length).toBe(2);
    expect((await b.db.select().from(postTags)).length).toBe(2);
  });

  it("公開済みの記事が 0 件でも、空の集計物を作る", async () => {
    const { deps, store } = setup();
    expect(await republishAll(deps)).toEqual({ republished: [], failed: [] });
    expect(JSON.parse((await store.get(INDEX_KEY))!)).toEqual({ posts: [], tags: [] });
  });
});
