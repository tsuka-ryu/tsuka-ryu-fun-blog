// D1 のブログのデータ（記事・履歴・タグ・画像の管理表）を、管理 API 経由で JSON に書き出す。
//
//   ADMIN_API_TOKEN=... node scripts/backup.mjs <オリジン> [出力先のディレクトリ]
//
// 出力先の既定は `backups/`（Git に入れない）。ファイル名は `blog-<日時>.json`。
// 復元は `POST /api/admin/restore`（空の D1 にだけ戻せる）。手順は docs/backup.md。

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const origin = process.argv[2];
const outDir = process.argv[3] ?? "backups";
const token = process.env.ADMIN_API_TOKEN;
if (!origin || !token) {
  console.error("使い方: ADMIN_API_TOKEN=... node scripts/backup.mjs <オリジン> [出力先]");
  process.exit(1);
}

const response = await fetch(new URL("/api/admin/export", origin), {
  headers: { authorization: `Bearer ${token}` },
});
if (!response.ok) {
  console.error(`書き出しに失敗しました: ${response.status} ${await response.text()}`);
  process.exit(1);
}
const backup = await response.json();
mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `blog-${backup.exportedAt.replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify(backup, null, 2));
console.log(
  `${file}: 記事 ${backup.posts.length} 件 / 版 ${backup.revisions.length} 件 / タグ ${backup.tags.length} 件`,
);
