import { readdirSync, readFileSync } from "node:fs";

import { isAdminAccount } from "#site/admin-account.js";
import { FakeD1 } from "#site/fake-d1.js";
import { INDEX_KEY, postJsonKey } from "#site/keys.js";
import {
  getDraft,
  getPostBySlug,
  listRevisions,
  listTags,
  restoreRevision,
  saveDraft,
  type Db,
} from "#site/posts.js";
import { publishPost, renameTag, type PublishDeps } from "#site/publish.js";
import { MemoryStore } from "#site/store.js";
import { describe, expect, it } from "vitest";
import { createDb } from "void/db";

import { postRevisions, posts, postTags, tags } from "../../db/schema.ts";

import type { SiteIndex } from "#content.js";

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
    revalidate: async () => {},
    now: () => new Date(clock),
  };
  return { deps, db, store, advance: (ms: number) => (clock += ms) };
}

const input = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  title: `記事 ${slug}`,
  description: "",
  date: "2026-10-01",
  tags: ["Git"],
  body: "本文です。\n",
  ...extra,
});

describe("履歴（snapshot）", () => {
  it("間隔が空くまで snapshot は増えず、空くと増える", async () => {
    const { db, deps, advance } = setup();
    await saveDraft(db, input("h", { body: "1" }), deps.now());
    await saveDraft(db, input("h", { body: "2" }), deps.now());
    advance(60_000);
    await saveDraft(db, input("h", { body: "3" }), deps.now());
    const post = (await getPostBySlug(db, "h"))!;
    expect((await listRevisions(db, post.id)).filter((r) => r.kind === "snapshot")).toHaveLength(1);

    advance(10 * 60_000);
    await saveDraft(db, input("h", { body: "4" }), deps.now());
    expect((await listRevisions(db, post.id)).filter((r) => r.kind === "snapshot")).toHaveLength(2);
  });

  it("内容が変わらない保存では、snapshot を増やさない", async () => {
    const { db, deps, advance } = setup();
    await saveDraft(db, input("same"), deps.now());
    advance(60 * 60_000);
    await saveDraft(db, input("same"), deps.now());
    const post = (await getPostBySlug(db, "same"))!;
    expect((await listRevisions(db, post.id)).filter((r) => r.kind === "snapshot")).toHaveLength(1);
  });

  it("件数の上限を超えたら古い snapshot から消え、公開版は消えない", async () => {
    const { db, deps, advance } = setup();
    const opts = { snapshotIntervalMs: 0, maxSnapshots: 3 };
    await saveDraft(db, input("cap", { body: "公開用" }), deps.now(), opts);
    await publishPost(deps, "cap");
    for (let i = 0; i < 6; i++) {
      advance(1000);
      await saveDraft(db, input("cap", { body: `版 ${i}` }), deps.now(), opts);
    }
    const post = (await getPostBySlug(db, "cap"))!;
    const revisions = await listRevisions(db, post.id);
    expect(revisions.filter((r) => r.kind === "snapshot")).toHaveLength(3);
    expect(revisions.filter((r) => r.kind === "published")).toHaveLength(1);
    expect(revisions.filter((r) => r.kind === "draft")).toHaveLength(1);
  });

  it("過去の版を下書きに戻せる。戻す前の下書きは履歴に残り、公開中の版は変わらない", async () => {
    const { db, deps, store, advance } = setup();
    await saveDraft(db, input("rb", { body: "最初" }), deps.now());
    await publishPost(deps, "rb");
    advance(10 * 60_000);
    await saveDraft(db, input("rb", { body: "書き換え" }), deps.now());
    const post = (await getPostBySlug(db, "rb"))!;
    const first = (await listRevisions(db, post.id)).find((r) => r.kind === "published")!;

    expect(await restoreRevision(db, post, first.id, deps.now())).toBe(true);
    expect((await getDraft(db, post.id))!.body).toBe("最初");
    expect((await listRevisions(db, post.id)).some((r) => r.kind === "snapshot")).toBe(true);
    // 公開中の版（R2）は、公開し直すまで変わらない。
    expect(JSON.parse((await store.get(postJsonKey("rb")))!).body).toContain("最初");
    expect(await restoreRevision(db, post, 99999, deps.now())).toBe(false);
  });
});

describe("タグ", () => {
  it("一覧は、タグと記事数を返す", async () => {
    const { db, deps } = setup();
    await saveDraft(db, input("a", { tags: ["Git", "雑記"] }), deps.now());
    await saveDraft(db, input("b", { tags: ["Git"] }), deps.now());
    await publishPost(deps, "a");
    await publishPost(deps, "b");
    const list = await listTags(db);
    expect(list.map((t) => [t.name, Number(t.count)])).toEqual([
      ["Git", 2],
      ["雑記", 1],
    ]);
  });

  it("名前の一括変更は、公開中の記事を未公開の変更なしで公開し直し、古いタグを消す", async () => {
    const { db, deps, store } = setup();
    await saveDraft(db, input("a", { tags: ["Github", "雑記"], body: "公開した本文" }), deps.now());
    await publishPost(deps, "a");
    // 未公開の下書きの変更（公開し直しで載ってはいけない）
    await saveDraft(db, input("a", { tags: ["Github", "雑記"], body: "未公開の変更" }), deps.now());

    const result = await renameTag(deps, "Github", "GitHub");
    expect(result).toEqual({ renamed: ["a"], failed: [] });

    const post = JSON.parse((await store.get(postJsonKey("a")))!);
    expect(post.frontmatter.tags).toEqual(["GitHub", "雑記"]);
    expect(post.body).toContain("公開した本文");
    expect(post.body).not.toContain("未公開の変更");

    const post1 = (await getPostBySlug(db, "a"))!;
    expect(JSON.parse((await getDraft(db, post1.id))!.tags)).toEqual(["GitHub", "雑記"]);
    expect((await getDraft(db, post1.id))!.body).toContain("未公開の変更");
    expect((await db.select().from(tags)).map((t) => t.name).sort()).toEqual(["GitHub", "雑記"]);
    expect((await db.select().from(postTags)).length).toBe(2);
    const index = JSON.parse((await store.get(INDEX_KEY))!) as SiteIndex;
    expect(index.tags.map((t) => t.tag).sort()).toEqual(["GitHub", "雑記"]);
  });

  it("すでにあるタグへの変更は統合され、タグの数が減る", async () => {
    const { db, deps } = setup();
    await saveDraft(db, input("a", { tags: ["git"] }), deps.now());
    await saveDraft(db, input("b", { tags: ["Git"] }), deps.now());
    await publishPost(deps, "a");
    await publishPost(deps, "b");
    await renameTag(deps, "git", "Git");
    expect((await listTags(db)).map((t) => [t.name, Number(t.count)])).toEqual([["Git", 2]]);
  });

  it("LIKE の特殊文字を含むタグ名でも、別のタグを巻き込まない", async () => {
    const { db, deps } = setup();
    await saveDraft(db, input("a", { tags: ["100%"] }), deps.now());
    await saveDraft(db, input("b", { tags: ["1000"] }), deps.now());
    await publishPost(deps, "a");
    await publishPost(deps, "b");
    const result = await renameTag(deps, "100%", "百パーセント");
    expect(result.renamed).toEqual(["a"]);
    expect((await db.select().from(posts)).length).toBe(2);
    expect((await db.select().from(postRevisions)).some((r) => r.tags.includes("1000"))).toBe(true);
  });
});

describe("isAdminAccount", () => {
  it("自分の GitHub ID だけを認める", () => {
    expect(isAdminAccount({ providerId: "github", accountId: "123" }, "123")).toBe(true);
    expect(isAdminAccount({ providerId: "github", accountId: "124" }, "123")).toBe(false);
    expect(isAdminAccount({ providerId: "google", accountId: "123" }, "123")).toBe(false);
  });

  it("ADMIN_GITHUB_ID が未設定・空なら、誰も認めない", () => {
    expect(isAdminAccount({ providerId: "github", accountId: "123" }, undefined)).toBe(false);
    expect(isAdminAccount({ providerId: "github", accountId: "" }, "")).toBe(false);
  });
});
