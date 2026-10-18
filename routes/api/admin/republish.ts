import { publishDeps, requireAdmin } from "#site/admin.js";
import { republishAll } from "#site/publish.js";
import { defineHandler } from "void";

// POST /api/admin/republish  公開中の全記事を、公開中の版の内容のまま公開し直す
// （パーサー・描画の変更後に、保存済みのスナップショットを作り直す）。
export const POST = defineHandler(async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  return c.json(await republishAll(publishDeps()));
});
