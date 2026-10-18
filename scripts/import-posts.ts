// content/posts/*.md を、管理 API 経由で D1 / R2 に取り込む（冪等。何度流しても重複しない）。
//
//   ADMIN_API_TOKEN=... node scripts/import-posts.ts [オリジン]      （既定: http://localhost:5173）
//
// `draft: true` の記事は下書きとして入り、公開されない。検証に失敗した記事があれば、終了コード 1 で終わる。

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const origin = process.argv[2] ?? "http://localhost:5173";
const token = process.env.ADMIN_API_TOKEN;
if (!token) {
  console.error("ADMIN_API_TOKEN を環境変数で渡してください");
  process.exit(1);
}

const dir = path.join(import.meta.dirname, "../content/posts");
const files = readdirSync(dir)
  .filter((file) => file.endsWith(".md"))
  .sort();

let failed = 0;
for (const file of files) {
  const slug = file.replace(/\.md$/, "");
  const response = await fetch(new URL("/api/admin/import", origin), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ slug, raw: readFileSync(path.join(dir, file), "utf8") }),
  });
  const result = (await response.json()) as { status?: string; error?: string; errors?: unknown };
  const ok = response.ok && (result.status === "published" || result.status === "draft");
  if (!ok) failed += 1;
  console.log(`${ok ? "✓" : "✗"} ${slug}: ${result.status ?? result.error}`);
  if (!ok && result.errors) console.log(JSON.stringify(result.errors, null, 2));
}
console.log(`${files.length - failed}/${files.length} 件を取り込みました`);
process.exit(failed > 0 ? 1 : 0);
