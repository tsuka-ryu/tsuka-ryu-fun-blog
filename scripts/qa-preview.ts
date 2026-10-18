// 移行後の品質確認（ビルド済みのサイトを、本番に近い workerd 上で動かして確かめる）。
//
//   pnpm build && node scripts/qa-preview.ts          （Chromium の場所は VRT_CHROMIUM_PATH）
//
// 確かめること:
//  - 公開中の記事: HTML（canonical・og:image・Markdown への alternate）、`.md`、OG 画像（PNG 1200×630）、sitemap・feed・検索索引
//  - 下書きの記事は、HTML・`.md`・OG・sitemap・feed・検索索引のどこにも出ない
//  - RSS が正しい XML で、記事数・必須の要素・日付の形式がそろっている
//  - 管理画面は、未認証だとログイン画面へ送られ、管理 API は 403
//  - **D1 の全テーブルを消した状態でも、公開側がすべて同じ結果で返る**（公開側が D1 を使わないことの確認）
// 見た目は VRT（pnpm run test:vrt）、URL の 301 は本番で確かめる（ローカルのプレビューでは評価されない）。

import { readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { chromium, type Browser } from "playwright";

import { startPreview } from "./lib/preview.ts";

const root = path.resolve(import.meta.dirname, "..");
const stateDir = path.join(root, ".qa-state");

// 記事を、公開するものと下書きに分ける（content/posts/*.md の frontmatter から）。
const published: string[] = [];
const drafts: string[] = [];
for (const file of readdirSync(path.join(root, "content/posts")).filter((f) => f.endsWith(".md"))) {
  const slug = file.replace(/\.md$/, "");
  const frontmatter =
    /^---\r?\n([\s\S]*?)\r?\n---/.exec(
      readFileSync(path.join(root, "content/posts", file), "utf8"),
    )?.[1] ?? "";
  (/^draft:\s*true\s*$/m.test(frontmatter) ? drafts : published).push(slug);
}

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} ${label}${!ok && detail ? ` — ${detail}` : ""}`);
}

async function status(origin: string, urlPath: string, init?: RequestInit): Promise<Response> {
  return fetch(`${origin}${urlPath}`, { redirect: "manual", ...init });
}

/** PNG の IHDR から、幅と高さを読む。 */
function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((b, i) => bytes[i] === b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function checkPublic(origin: string, browser: Browser): Promise<void> {
  const sitemap = await (await status(origin, "/sitemap.xml")).text();
  const searchIndex = (await (await status(origin, "/search-index.json")).json()) as Array<{
    id: string;
  }>;
  const feed = await (await status(origin, "/feed.xml")).text();

  check(
    "sitemap に、トップ・About・タグ一覧がある",
    ["/", "/about", "/tags"].every((p) =>
      sitemap.includes(`<loc>https://tsuka-ryu.dev${p === "/" ? "/" : p}</loc>`),
    ),
  );
  check(
    `sitemap の記事は公開中の ${published.length} 件ちょうど`,
    published.every((s) => sitemap.includes(`/posts/${s}</loc>`)) &&
      (sitemap.match(/\/posts\//g) ?? []).length === published.length,
  );
  check(
    `検索索引は公開中の ${published.length} 件`,
    searchIndex.length === published.length &&
      published.every((s) => searchIndex.some((d) => d.id === s)),
  );

  // 記事ごと: HTML・.md・OG 画像
  const problems: string[] = [];
  for (const slug of published) {
    const html = await (await status(origin, `/posts/${slug}`)).text();
    if (!html.includes(`<link rel="canonical" href="https://tsuka-ryu.dev/posts/${slug}"`))
      problems.push(`${slug}: canonical`);
    if (!html.includes(`content="https://tsuka-ryu.dev/og/${slug}.png"`))
      problems.push(`${slug}: og:image`);
    if (
      !html.includes(
        `rel="alternate" type="text/markdown" href="https://tsuka-ryu.dev/posts/${slug}.md"`,
      )
    )
      problems.push(`${slug}: markdown alternate`);
    const md = await status(origin, `/posts/${slug}.md`);
    const mdText = await md.text();
    if (
      md.status !== 200 ||
      !md.headers.get("content-type")?.startsWith("text/markdown") ||
      !mdText.startsWith("---\n")
    )
      problems.push(`${slug}: .md`);
    if (md.headers.get("x-content-type-options") !== "nosniff")
      problems.push(`${slug}: .md nosniff`);
    const og = await status(origin, `/og/${slug}.png`);
    const size = pngSize(new Uint8Array(await og.arrayBuffer()));
    if (og.status !== 200 || size?.width !== 1200 || size.height !== 630)
      problems.push(`${slug}: OG 画像`);
  }
  check(
    `公開中の ${published.length} 記事: HTML・.md・OG 画像がそろう`,
    problems.length === 0,
    problems.join(", "),
  );

  // 下書きは、どこにも出ない
  const leaked: string[] = [];
  for (const slug of drafts) {
    for (const urlPath of [`/posts/${slug}`, `/posts/${slug}.md`, `/og/${slug}.png`]) {
      if ((await status(origin, urlPath)).status !== 404) leaked.push(urlPath);
    }
    if ([sitemap, feed, JSON.stringify(searchIndex)].some((text) => text.includes(slug)))
      leaked.push(`${slug}（一覧）`);
  }
  check(
    `下書き ${drafts.length} 件は、HTML・.md・OG・sitemap・feed・検索索引のどこにも出ない`,
    leaked.length === 0,
    leaked.join(", "),
  );

  // RSS: 正しい XML で、必須の要素がそろう（ブラウザの XML パーサーで確かめる）
  const page = await browser.newPage();
  const parsed = await page.evaluate((xml) => {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.querySelector("parsererror"))
      return { wellFormed: false, items: 0, incomplete: ["parsererror"] };
    const incomplete: string[] = [];
    const rfc822 = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} [+-]\d{4}$/;
    const items = [...doc.querySelectorAll("item")];
    for (const item of items) {
      const text = (tag: string) => item.getElementsByTagName(tag)[0]?.textContent ?? "";
      const link = text("link");
      if (!text("title") || !link.startsWith("https://") || text("guid") !== link)
        incomplete.push(link || "(link なし)");
      if (!rfc822.test(text("pubDate"))) incomplete.push(`${link}: pubDate`);
      if (!text("content:encoded")) incomplete.push(`${link}: content:encoded`);
    }
    return { wellFormed: true, items: items.length, incomplete };
  }, feed);
  await page.close();
  check("feed.xml は正しい XML", parsed.wellFormed);
  check(
    `feed.xml の記事は公開中の ${published.length} 件で、title・link・guid・pubDate（RFC 822）・本文がそろう`,
    parsed.items === published.length && parsed.incomplete.length === 0,
    parsed.incomplete.slice(0, 3).join(", "),
  );

  // 管理画面は閉じている
  const admin = await status(origin, "/admin");
  check(
    "未認証の /admin は、ログイン画面へ送られる",
    admin.status >= 300 &&
      admin.status < 400 &&
      admin.headers.get("location")?.endsWith("/admin/login") === true,
    `${admin.status} ${admin.headers.get("location")}`,
  );
  check("未認証の管理 API は 403", (await status(origin, "/api/admin/posts")).status === 403);
  check(
    "ログイン画面は noindex",
    (await (await status(origin, "/admin/login")).text()).includes(
      'name="robots" content="noindex"',
    ),
  );
  const missing = await status(origin, "/posts/no-such-post");
  check(
    "存在しない記事は 404 で noindex",
    missing.status === 404 && (await missing.text()).includes('content="noindex"'),
  );
  check(
    "画像配信は、不正なキーを通さない",
    (await status(origin, "/uploads/..%2Fpublished%2Findex.json")).status === 404,
  );
}

/** ローカルの D1 の全テーブルを消す（プレビューを止めてから行う）。 */
function dropAllD1Tables(): number {
  const dir = path.join(stateDir, "v3/d1/miniflare-D1DatabaseObject");
  let dropped = 0;
  for (const file of readdirSync(dir).filter(
    (f) => f.endsWith(".sqlite") && f !== "metadata.sqlite",
  )) {
    const db = new DatabaseSync(path.join(dir, file));
    db.exec("PRAGMA foreign_keys = OFF");
    const tables = db
      .prepare(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '_cf_%'",
      )
      .all() as Array<{ name: string }>;
    for (const { name } of tables) db.exec(`drop table "${name}"`);
    db.close();
    dropped += tables.length;
  }
  return dropped;
}

const preview = await startPreview({
  root,
  port: 4397,
  stateDir,
  logFile: path.join(stateDir, "../.qa-preview.log"),
});
const browser = await chromium.launch({ executablePath: process.env.VRT_CHROMIUM_PATH });
try {
  console.log(`公開 ${published.length} 件 / 下書き ${drafts.length} 件\n== 通常の状態`);
  await checkPublic(preview.origin, browser);

  console.log("\n== D1 の全テーブルを消した状態（公開側は D1 を使わない）");
  preview.stop();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  console.log(`  ${dropAllD1Tables()} テーブルを削除`);
  await preview.restart();
  await checkPublic(preview.origin, browser);
  check(
    "管理 API は D1 が必要なので、D1 がないと 500（公開側との違いの確認）",
    (
      await status(preview.origin, "/api/admin/posts", {
        headers: { authorization: `Bearer ${preview.token}` },
      })
    ).status === 500,
  );
} finally {
  await browser.close();
  preview.stop();
  rmSync(stateDir, { recursive: true, force: true });
}
console.log(failures === 0 ? "\nすべて通りました" : `\n${failures} 件が失敗しました`);
process.exit(failures === 0 ? 0 : 1);
