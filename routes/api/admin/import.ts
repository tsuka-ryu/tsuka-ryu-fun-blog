import { publishDeps, requireAdmin } from "#site/admin.js";
import { importMarkdown } from "#site/import-markdown.js";
import { isValidSlug } from "#site/posts.js";
import { defineHandler } from "void";

// POST /api/admin/import  { slug, raw }
// frontmatter 付きの Markdown 原文を、下書きとして保存し、`draft: true` でなければ公開する（冪等）。
export const POST = defineHandler(async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;

  const body = (await c.req.json().catch(() => null)) as { slug?: unknown; raw?: unknown } | null;
  if (typeof body?.slug !== "string" || typeof body.raw !== "string" || !isValidSlug(body.slug)) {
    return c.json(
      { error: "slug（小文字の英数字とハイフン）と raw（Markdown 原文）が必要です" },
      400,
    );
  }
  return c.json(await importMarkdown(publishDeps(), body.slug, body.raw));
});
