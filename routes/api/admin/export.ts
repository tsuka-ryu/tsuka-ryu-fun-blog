import { publishDeps, requireAdmin } from "#site/admin.js";
import { exportBackup } from "#site/backup.js";
import { defineHandler } from "void";

// GET /api/admin/export  D1 のブログのデータ（記事・履歴・タグ・画像の管理表）を JSON で書き出す。
// 定期的に取って保管する（scripts/backup.mjs）。
export const GET = defineHandler(async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;

  const deps = publishDeps();
  return c.json(await exportBackup(deps.db, deps.now()));
});
