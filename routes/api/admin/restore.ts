import { publishDeps, requireAdmin } from "#site/admin.js";
import { BackupError, restoreBackup } from "#site/backup.js";
import { republishAll } from "#site/publish.js";
import { defineHandler } from "void";

// POST /api/admin/restore  書き出した JSON を、空の D1 に戻し、公開中の記事を R2 に公開し直す。
// すでに記事がある D1 には戻せない（409）。
export const POST = defineHandler(async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;

  const body = await c.req.json().catch(() => null);
  const deps = publishDeps();
  try {
    const restored = await restoreBackup(deps.db, body);
    return c.json({ restored, republished: await republishAll(deps) });
  } catch (error) {
    if (error instanceof BackupError) return c.json({ error: error.message }, 409);
    throw error;
  }
});
