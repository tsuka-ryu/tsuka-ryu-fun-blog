import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// 公開側（読者のリクエストで動くコード）は、D1 に触れてはいけない（D1 は読み取り行数で課金されるので、
// 公開側のアクセスが増えても請求が増えない構成にする）。公開側の入口から import を辿り、
// D1 に触れるモジュールに届かないことを確かめる。

const root = path.resolve(import.meta.dirname, "../..");

/** 公開側が、直接にも間接にも import してはいけないもの。 */
const FORBIDDEN: Array<{ test: (spec: string, resolved: string | null) => boolean; why: string }> =
  [
    { test: (spec) => spec === "void/db", why: "void/db（D1）" },
    { test: (spec) => spec === "@schema", why: "@schema（D1 のスキーマ）" },
    { test: (_, resolved) => resolved?.endsWith("db/schema.ts") ?? false, why: "db/schema.ts" },
    {
      test: (_, resolved) => resolved?.endsWith("src/site/posts.ts") ?? false,
      why: "#site/posts（D1 の操作）",
    },
    {
      test: (_, resolved) => resolved?.endsWith("src/site/publish.ts") ?? false,
      why: "#site/publish（公開関数）",
    },
  ];

function walk(dir: string, accept: (file: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    return statSync(file).isDirectory() ? walk(file, accept) : accept(file) ? [file] : [];
  });
}

/** `#a/b.js` や `./x.ts` を、実在するソースのパスにする（外部パッケージなら null）。 */
function resolveImport(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("#")) base = path.join(root, "src", spec.slice(1));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  const stem = base.replace(/\.(js|ts|tsx|jsx)$/, "");
  for (const candidate of [
    `${stem}.ts`,
    `${stem}.tsx`,
    path.join(stem, "index.ts"),
    path.join(stem, "index.tsx"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const specs: string[] = [];
  for (const match of source.matchAll(
    /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g,
  )) {
    // `import type` は実行時に存在しない。
    if (/^\s*(?:import|export)\s+type\s/.test(match[0].replace(/^\n/, ""))) continue;
    specs.push(match[1]!);
  }
  for (const match of source.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g))
    specs.push(match[1]!);
  return specs;
}

function entries(): string[] {
  return [
    // 管理画面（pages/admin/）は、認可したうえで D1 を使うので、公開側ではない。
    ...walk(
      path.join(root, "pages"),
      (f) =>
        (f.endsWith(".server.ts") || f.endsWith(".island.tsx")) &&
        !f.includes(`${path.sep}pages${path.sep}admin${path.sep}`),
    ),
    ...walk(path.join(root, "middleware"), (f) => f.endsWith(".ts")),
    path.join(root, "routes/feed.xml.ts"),
    path.join(root, "routes/sitemap.xml.ts"),
    path.join(root, "routes/search-index.json.ts"),
  ];
}

function violations(): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const queue = entries().map((file) => ({ file, trail: [path.relative(root, file)] }));
  while (queue.length > 0) {
    const { file, trail } = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of importsOf(file)) {
      const resolved = resolveImport(spec, file);
      const hit = FORBIDDEN.find((rule) => rule.test(spec, resolved));
      if (hit) found.push(`${trail.join(" → ")} → ${spec}（${hit.why}）`);
      else if (resolved)
        queue.push({ file: resolved, trail: [...trail, path.relative(root, resolved)] });
    }
  }
  return found;
}

describe("公開側は D1 に触れない", () => {
  it("公開ページ・公開ルート・ミドルウェアの依存に、D1 に触れるモジュールがない", () => {
    expect(violations()).toEqual([]);
  });

  it("入口が見つかっている（このテスト自体が空振りしていない）", () => {
    const files = entries();
    expect(files.length).toBeGreaterThan(8);
    for (const file of files) expect(existsSync(file), file).toBe(true);
  });

  it("検出が働く: D1 を import するファイルを入口に足すと違反として見つかる", () => {
    const fake = path.join(root, "src/site/posts.ts");
    expect(importsOf(fake).some((spec) => spec === "void/db")).toBe(true);
  });
});
