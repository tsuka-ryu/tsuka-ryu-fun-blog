// 管理画面の通しの確認（ブラウザ操作）。開発サーバーを、認可を省く設定で起動してから流す。
//
//   .env に ADMIN_DEV_BYPASS=1 と、ダミーの AUTH_GITHUB_CLIENT_ID / AUTH_GITHUB_CLIENT_SECRET を書く（docs/local-env.md 参照）
//   pnpm exec void db migrate && pnpm exec vite --port 5199
//   node scripts/e2e-admin.mjs [オリジン]        （Chromium の場所は VRT_CHROMIUM_PATH）
//
// 新規作成 → 入力 → 自動保存 → プレビューのエラー表示とジャンプ → タグ → 画像の貼り付け（WebP 変換）→ 公開
// （HTML・.md・画像の配信）→ 編集 → 履歴の差分と巻き戻し → タグ名の一括変更 → 取り下げ → 削除、までを確かめる。
// 本番のビルドでは認可を省く分岐が消えるので、このスクリプトは `vite preview` には使えない。

import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:5199";
const run = Date.now().toString(36);
const slug = `e2e-${run}`;
// ローカルの D1 には前回までのタグが残るので、実行ごとに一意の名前を使う。
const tagA = `タグ${run}`;
const tagB = `${tagA}改`;
const shot = (name) =>
  page.screenshot({ path: path.join(tmpdir(), `admin-e2e-${name}.png`), fullPage: true });
const log = (...a) => console.log(...a);
const browser = await chromium.launch({ executablePath: process.env.VRT_CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => log("PAGEERROR", e.message));
page.on("console", (m) => m.type() === "error" && log("CONSOLE", m.text().slice(0, 200)));

await page.goto(`${base}/admin/posts/new`);
await page.waitForSelector(".cm-content");
await page.fill('input[placeholder="2026-10-18-my-post"]', slug);
await page.locator(".admin-field", { hasText: "タイトル" }).locator("input").fill("E2E の記事");
await page.click(".cm-content");
await page.keyboard.type("## 見出し\n\n本文です。\n\n## 見出し\n\n```ts\nconst a = 1;\n```\n");

// 自動保存
await page.waitForSelector(".admin-save-saved", { timeout: 8000 });
log("autosaved:", await page.locator(".admin-save").innerText(), "url:", page.url());

// プレビュー: 重複見出しのエラーが出る
await page.click('[role=tab]:has-text("プレビュー")');
await page.waitForSelector(".admin-diagnostics-list");
log("diagnostics:", await page.locator(".admin-diagnostics-title").innerText());
log("publish disabled:", await page.locator(".admin-primary").isDisabled());
await shot("1-preview-errors");
await page.click(".admin-diagnostic-jump");
await page.waitForSelector(".cm-content", { state: "visible" });
log("jumped to edit tab; line:", await page.locator(".cm-activeLine").innerText());

// エラーを直す
await page.keyboard.press("Control+a");
await page.keyboard.type("## はじめに\n\n本文です。\n\n## コード\n\n```ts\nconst a = 1;\n```\n");
await page.click('[role=tab]:has-text("プレビュー")');
await page.waitForSelector(".admin-diagnostics-title");
log("after fix:", await page.locator(".admin-diagnostics-title").innerText());
await page.waitForTimeout(1500);
await shot("2-preview-ok");

// タグ
await page.click('[role=tab]:has-text("編集")');
const tagInput = page.locator('input[aria-label="タグを追加"]');
await tagInput.fill(tagA);
await tagInput.press("Enter");
await tagInput.fill("雑記");
await tagInput.press("Enter");
log("chips:", await page.locator(".admin-tag-chip").allInnerTexts());

// 画像の貼り付け
await page.evaluate(async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 40;
  canvas.height = 30;
  canvas.getContext("2d").fillStyle = "#c2540c";
  canvas.getContext("2d").fillRect(0, 0, 40, 30);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  const file = new File([blob], "a.png", { type: "image/png" });
  const dt = new DataTransfer();
  dt.items.add(file);
  document
    .querySelector(".cm-content")
    .dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  return true;
});
await page.waitForFunction(
  () => document.querySelector(".cm-content")?.textContent?.includes("/uploads/"),
  null,
  { timeout: 8000 },
);
const bodyText = await page.locator(".cm-content").innerText();
log(
  "image inserted:",
  /!\[\]\(\/uploads\/\d{4}\/\d{2}\/[0-9a-f]{32}\.webp\)/.test(bodyText)
    ? "webp url ok"
    : bodyText.slice(-80),
);

// 公開
await page.waitForSelector(".admin-save-saved", { timeout: 8000 });
await page.click("text=公開する");
await page.waitForSelector(".admin-status-published");
log("notice:", await page.locator(".admin-notice").innerText());
const pub = await page.request.get(`${base}/posts/${slug}`);
log("public html:", pub.status(), (await pub.text()).includes("E2E の記事"));
const md = await page.request.get(`${base}/posts/${slug}.md`);
log("public md:", md.status(), (await md.text()).split("\n").slice(0, 5).join("|"));
const imgUrl = bodyText.match(/\/uploads\/[^)]+/)[0];
const img = await page.request.get(base + imgUrl);
log("image:", img.status(), img.headers()["content-type"], img.headers()["cache-control"]);

// 編集 → 未公開の変更 → 履歴 → 巻き戻し
await page.click(".cm-content");
await page.keyboard.press("Control+End");
await page.keyboard.type("\n追記した行\n");
await page.waitForSelector(".admin-save-saved", { timeout: 8000 });
log("changed badge:", await page.locator(".admin-status-changed").count());
await page.click("text=履歴");
await page.waitForSelector(".admin-history-list li");
log("history entries:", await page.locator(".admin-history-list li").count());
await page.locator(".admin-history-list li", { hasText: "公開した版" }).first().click();
await page.waitForSelector(".admin-diff");
await shot("3-history");
log("diff add lines:", await page.locator(".admin-diff-add").count());
page.once("dialog", (d) => d.accept());
await page.click("text=この版に戻す");
await page.waitForSelector("text=下書きを巻き戻しました");
log(
  "restored body keeps 追記 (expect false):",
  (await page.locator(".cm-content").innerText()).includes("追記した行"),
);

// 再読み込みで同じ内容が開く
await page.goto(`${base}/admin/posts/${slug}`);
await page.waitForSelector(".cm-content");
log(
  "reload title:",
  await page.locator(".admin-field", { hasText: "タイトル" }).locator("input").inputValue(),
);
log(
  "reload slug readonly:",
  (await page.locator('input[placeholder="2026-10-18-my-post"]').getAttribute("readonly")) !== null,
);

// 一覧・タグ管理
await page.goto(`${base}/admin`);
log("list has post:", (await page.locator(".admin-table").innerText()).includes(slug));
await page.goto(`${base}/admin/tags`);
await page.waitForSelector('[data-island$="TagManager"][data-hydrated="true"]');
await page.locator("tr", { hasText: tagA }).locator("button", { hasText: "名前を変える" }).click();
await page.locator('input[aria-label$="の新しい名前"]').fill(tagB);
await page.click("text=変更する");
await page.waitForSelector("text=件の記事のタグを変更しました");
log("tag rename:", await page.locator("[role=status]").innerText());
const after = await (await page.request.get(`${base}/posts/${slug}`)).text();
log("public shows renamed tag:", after.includes(tagB), "old gone:", !after.includes(`>${tagA}<`));

// 取り下げ
await page.goto(`${base}/admin/posts/${slug}`);
await page.waitForSelector(".cm-content");
page.once("dialog", (d) => d.accept());
await page.click("text=取り下げ");
await page.waitForSelector(".admin-status-draft");
log(
  "after unpublish:",
  (await page.request.get(`${base}/posts/${slug}`)).status(),
  (await page.request.get(`${base}/posts/${slug}.md`)).status(),
);

// 削除（履歴ごと消え、一覧からもなくなる）
page.once("dialog", (d) => d.accept());
await page.click("text=削除");
await page.waitForURL(`${base}/admin`);
log("after delete in list:", (await page.locator(".admin-table").innerText()).includes(slug));
log("after delete api:", (await page.request.get(`${base}/api/admin/posts/${slug}`)).status());

// 画面幅（モバイル）
await page.setViewportSize({ width: 390, height: 800 });
await page.goto(`${base}/admin/posts/new`);
await page.waitForSelector(".cm-content");
await shot("4-mobile");
await browser.close();
log("DONE", slug);
