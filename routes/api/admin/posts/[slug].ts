import { publishDeps, requireAdmin } from "#site/admin.js";
import { getPostDetail, isValidSlug, saveDraft } from "#site/posts.js";
import { deletePost } from "#site/publish.js";
import { defineHandler } from "void";

// GET /api/admin/posts/:slug  編集画面が開く記事（下書きの内容と、公開の状態）
export const GET = defineHandler(async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;

  const detail = await getPostDetail(publishDeps().db, c.req.param("slug") ?? "");
  return detail ? c.json(detail) : c.json({ error: "not_found" }, 404);
});

// PUT /api/admin/posts/:slug  { title, description?, date, tags?, body }  下書きを保存する（自動保存もこれ）
export const PUT = defineHandler(async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;

  const slug = c.req.param("slug") ?? "";
  if (!isValidSlug(slug)) return c.json({ error: "slug が正しくありません" }, 400);
  const input = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const tags = input?.tags ?? [];
  if (
    typeof input?.title !== "string" ||
    typeof input.date !== "string" ||
    typeof input.body !== "string" ||
    !Array.isArray(tags) ||
    !tags.every((tag) => typeof tag === "string") ||
    (input.description !== undefined && typeof input.description !== "string")
  ) {
    return c.json({ error: "title / date / body（文字列）と tags（文字列の配列）が必要です" }, 400);
  }
  const deps = publishDeps();
  await saveDraft(
    deps.db,
    {
      slug,
      title: input.title,
      description: input.description ?? "",
      date: input.date,
      tags: tags as string[],
      body: input.body,
    },
    deps.now(),
  );
  return c.json({ ok: true });
});

// DELETE /api/admin/posts/:slug  記事を完全に消す（公開中なら取り下げてから）
export const DELETE = defineHandler(async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;

  const result = await deletePost(publishDeps(), c.req.param("slug") ?? "");
  return c.json(result, result.ok ? 200 : 404);
});
