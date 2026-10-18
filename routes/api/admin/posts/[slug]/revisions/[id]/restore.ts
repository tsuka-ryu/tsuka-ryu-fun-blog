import { publishDeps, requireAdmin } from "#site/admin.js";
import { getPostBySlug, restoreRevision } from "#site/posts.js";
import { defineHandler } from "void";

// POST /api/admin/posts/:slug/revisions/:id/restore  その版を下書きに戻す（公開中の版は変わらない）
export const POST = defineHandler(async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;

  const deps = publishDeps();
  const post = await getPostBySlug(deps.db, c.req.param("slug") ?? "");
  if (!post) return c.json({ error: "not_found" }, 404);
  const restored = await restoreRevision(deps.db, post, Number(c.req.param("id")), deps.now());
  return restored ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});
