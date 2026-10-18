import { publishDeps, requireAdmin } from "#site/admin.js";
import { getPostBySlug, getRevision, revisionToInput } from "#site/posts.js";
import { defineHandler } from "void";

// GET /api/admin/posts/:slug/revisions/:id  1 つの版の内容（差分の確認用）
export const GET = defineHandler(async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;

  const { db } = publishDeps();
  const slug = c.req.param("slug") ?? "";
  const post = await getPostBySlug(db, slug);
  const revision = post && (await getRevision(db, post.id, Number(c.req.param("id"))));
  if (!revision) return c.json({ error: "not_found" }, 404);
  return c.json({
    id: revision.id,
    kind: revision.kind,
    createdAt: revision.createdAt,
    ...revisionToInput(slug, revision),
  });
});
