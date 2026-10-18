import { readdirSync, readFileSync } from "node:fs";

import { FakeD1 } from "#site/fake-d1.js";
import { INDEX_KEY, postJsonKey, postMarkdownKey } from "#site/keys.js";
import { saveDraft, type Db } from "#site/posts.js";
import { deletePost, publishPost, unpublishPost, type PublishDeps } from "#site/publish.js";
import { MemoryStore } from "#site/store.js";
import { beforeEach, describe, expect, it } from "vitest";
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
  const revalidated: string[][] = [];
  let tick = 0;
  const deps: PublishDeps = {
    db,
    store,
    revalidate: async (paths) => {
      revalidated.push(paths);
    },
    now: () => new Date(Date.UTC(2026, 9, 18, 0, 0, tick++)),
  };
  return { deps, db, store, revalidated };
}

const input = (slug: string, extra: Partial<Parameters<typeof saveDraft>[1]> = {}) => ({
  slug,
  title: `記事 ${slug}`,
  description: "説明",
  date: "2026-10-01",
  tags: ["Git", "雑記"],
  body: "## 見出し\n\nこれは本文です。\n\n```ts\nconst a = 1;\n```\n",
  ...extra,
});

async function readIndex(store: MemoryStore): Promise<SiteIndex> {
  return JSON.parse((await store.get(INDEX_KEY))!) as SiteIndex;
}

describe("publishPost", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("公開すると、R2 のスナップショットと集計物、D1 の公開版、ISR の無効化がそろう", async () => {
    const { deps, db, store, revalidated } = ctx;
    await saveDraft(db, input("hello"), deps.now());
    const result = await publishPost(deps, "hello");
    expect(result).toMatchObject({ ok: true });

    // 記事のスナップショットは、AST にコードのハイライトまで埋まっている。
    const post = JSON.parse((await store.get(postJsonKey("hello")))!);
    expect(post.frontmatter).toEqual({
      title: "記事 hello",
      description: "説明",
      date: "2026-10-01",
      tags: ["Git", "雑記"],
    });
    expect(JSON.stringify(post.mdast)).toContain('"highlight"');
    expect(post.toc).toEqual([{ depth: 2, text: "見出し", id: expect.any(String) }]);

    // `.md` は frontmatter 付きの原文。
    const md = (await store.get(postMarkdownKey("hello")))!;
    expect(md).toBe(
      "---\ntitle: 記事 hello\ndescription: 説明\ndate: 2026-10-01\ntags: [Git, 雑記]\n---\n\n" +
        "## 見出し\n\nこれは本文です。\n\n```ts\nconst a = 1;\n```\n",
    );

    expect((await readIndex(store)).posts.map((p) => p.slug)).toEqual(["hello"]);
    expect((await store.get("published/feed.xml"))!).toContain("<link>https://");
    expect((await store.get("published/sitemap.xml"))!).toContain("/posts/hello");
    expect(JSON.parse((await store.get("published/search-index.json"))!)).toHaveLength(1);

    const [row] = await db.select().from(posts);
    expect(row!.publishedRevisionId).not.toBeNull();
    expect(row!.publishedAt).not.toBeNull();
    expect((await db.select().from(postTags)).length).toBe(2);
    expect((await db.select().from(tags)).map((t) => t.name).sort()).toEqual(["Git", "雑記"]);

    expect(revalidated).toHaveLength(1);
    expect(revalidated[0]).toEqual(
      expect.arrayContaining([
        "/",
        "/posts/hello",
        "/posts/hello.md",
        "/tags",
        "/tags/git",
        "/feed.xml",
      ]),
    );
  });

  it("検証に失敗する記事は、R2 にも D1 の公開状態にも何も書かない", async () => {
    const { deps, db, store, revalidated } = ctx;
    await saveDraft(db, input("broken", { date: "2026/10/01" }), deps.now());
    const result = await publishPost(deps, "broken");
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(store.objects.size).toBe(0);
    const [row] = await db.select().from(posts);
    expect(row!.publishedRevisionId).toBeNull();
    expect(revalidated).toHaveLength(0);
  });

  it("存在しない記事・下書きのない記事は、理由つきで失敗する", async () => {
    const { deps } = ctx;
    expect(await publishPost(deps, "nope")).toEqual({ ok: false, reason: "not_found" });
  });

  it("2 回公開しても、公開版の履歴は増えず、R2 の内容は同じ", async () => {
    const { deps, db, store } = ctx;
    await saveDraft(db, input("twice"), deps.now());
    await publishPost(deps, "twice");
    const first = await store.get(postJsonKey("twice"));
    await publishPost(deps, "twice");
    expect(await store.get(postJsonKey("twice"))).toBe(first);
    const revisions = await db.select().from(postRevisions);
    expect(revisions.filter((r) => r.kind === "published")).toHaveLength(1);
    expect((await db.select().from(postTags)).length).toBe(2);
  });

  it("R2 への書き込みが途中で失敗したら D1 の公開状態は更新せず、直して再実行すれば収束する", async () => {
    const { deps, db, store } = ctx;
    await saveDraft(db, input("retry"), deps.now());
    store.failOn = (key) => key === postMarkdownKey("retry");
    await expect(publishPost(deps, "retry")).rejects.toThrow(/put failed/);
    const [row] = await db.select().from(posts);
    expect(row!.publishedRevisionId).toBeNull();
    expect(store.objects.has(INDEX_KEY)).toBe(false);

    store.failOn = () => false;
    expect(await publishPost(deps, "retry")).toMatchObject({ ok: true });
    expect((await readIndex(store)).posts.map((p) => p.slug)).toEqual(["retry"]);
  });

  it("更新すると新しい公開版が増え、外したタグは公開側から消え、旧タグのページも無効化する", async () => {
    const { deps, db, store, revalidated } = ctx;
    await saveDraft(db, input("edit"), deps.now());
    await publishPost(deps, "edit");
    await saveDraft(db, input("edit", { title: "更新後", tags: ["雑記"] }), deps.now());
    await publishPost(deps, "edit");

    const index = await readIndex(store);
    expect(index.posts[0]!.frontmatter.title).toBe("更新後");
    expect(index.tags.map((t) => t.tag)).toEqual(["雑記"]);
    expect((await db.select().from(postTags)).length).toBe(1);
    expect(
      (await db.select().from(postRevisions)).filter((r) => r.kind === "published"),
    ).toHaveLength(2);
    expect(revalidated.at(-1)).toContain("/tags/git");
  });

  it("下書きのままの記事は、公開側のどこにも出ない", async () => {
    const { deps, db, store } = ctx;
    await saveDraft(db, input("pub"), deps.now());
    await saveDraft(db, input("secret", { title: "下書き記事", date: "2026-10-02" }), deps.now());
    await publishPost(deps, "pub");

    const everything = [...store.objects.entries()].map(([k, v]) => k + v.body).join("\n");
    expect(everything).not.toContain("secret");
    expect(everything).not.toContain("下書き記事");
  });

  it("ISR の無効化に失敗しても公開は完了し、失敗が結果に載る", async () => {
    const { deps, db } = ctx;
    deps.revalidate = async () => {
      throw new Error("isr down");
    };
    await saveDraft(db, input("isr"), deps.now());
    expect(await publishPost(deps, "isr")).toMatchObject({ ok: true, revalidateError: "isr down" });
  });
});

describe("unpublishPost / deletePost", () => {
  it("取り下げると、R2 の記事と集計物から消え、下書きと履歴は残る。再公開もできる", async () => {
    const { deps, db, store } = setup();
    await saveDraft(db, input("a"), deps.now());
    await saveDraft(db, input("b", { date: "2026-10-02" }), deps.now());
    await publishPost(deps, "a");
    await publishPost(deps, "b");
    expect((await readIndex(store)).posts.map((p) => p.slug)).toEqual(["b", "a"]);

    expect(await unpublishPost(deps, "b")).toMatchObject({ ok: true });
    expect(store.objects.has(postJsonKey("b"))).toBe(false);
    expect(store.objects.has(postMarkdownKey("b"))).toBe(false);
    expect((await readIndex(store)).posts.map((p) => p.slug)).toEqual(["a"]);
    expect(await store.get("published/sitemap.xml")).not.toContain("/posts/b");
    expect(await store.get("published/feed.xml")).not.toContain("/posts/b");
    expect(JSON.parse((await store.get("published/search-index.json"))!)).toHaveLength(1);

    const rows = await db.select().from(posts);
    expect(rows.find((r) => r.slug === "b")!.publishedRevisionId).toBeNull();
    expect((await db.select().from(postRevisions)).some((r) => r.kind === "draft")).toBe(true);

    expect(await publishPost(deps, "b")).toMatchObject({ ok: true });
    expect((await readIndex(store)).posts).toHaveLength(2);
  });

  it("削除すると、D1 の行・履歴・タグの紐付けも消える", async () => {
    const { deps, db, store } = setup();
    await saveDraft(db, input("gone"), deps.now());
    await publishPost(deps, "gone");
    await deletePost(deps, "gone");
    expect(await db.select().from(posts)).toHaveLength(0);
    expect(await db.select().from(postRevisions)).toHaveLength(0);
    expect(await db.select().from(postTags)).toHaveLength(0);
    expect((await readIndex(store)).posts).toEqual([]);
  });
});

describe("saveDraft", () => {
  it("同じ記事の自動保存は、下書きの行を上書きする（履歴は間隔を空けてだけ増える）", async () => {
    const { deps, db } = setup();
    await saveDraft(db, input("auto"), deps.now());
    await saveDraft(db, input("auto", { body: "書き換え" }), deps.now());
    const drafts = (await db.select().from(postRevisions)).filter((r) => r.kind === "draft");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.body).toBe("書き換え");
  });

  it("slug に使えない文字は拒否する", async () => {
    const { deps, db } = setup();
    await expect(saveDraft(db, input("../evil"), deps.now())).rejects.toThrow(/slug/);
    await expect(saveDraft(db, input("Upper"), deps.now())).rejects.toThrow(/slug/);
  });
});
