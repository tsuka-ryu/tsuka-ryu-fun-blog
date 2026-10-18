import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";

// 移行前後で見た目が変わっていないことを確かめるスクリーンショットテスト。
// ビルド済みのサイト（dist/public）を、テストのページの中の iframe で読み込んで、
// ページ全体の画像をベースラインと比べる。ベースラインは __screenshots__ に置く。
//
// ベースラインを更新するのは、サイトの見た目か記事の内容を意図して変えたときだけ。
//   pnpm run test:vrt -- --update

const DESKTOP = { name: "desktop", width: 1280, height: 800 } as const;
const MOBILE = { name: "mobile", width: 390, height: 844 } as const;

// 記事の本文を書き換えている最中のものは、ベースラインが頻繁に変わるので対象から外す。
const EXCLUDED_PATHS = new Set(["/posts/2026-10-18-void-cloudflare-rebuild"]);

// モバイルは全ページを撮ると画像が増えすぎるので、構文の種類をカバーする代表だけを撮る。
// 表・引用・番号付きリスト・コードを含む記事、画像を含む記事、素朴な記事。
// sitemap にある（= 本番ビルドに含まれる）公開済みの記事だけを指定する。draft は対象外。
const MOBILE_PATHS = new Set([
  "/",
  "/about",
  "/tags",
  "/tags/oxc-ts-parser",
  "/posts/2026-09-27-oxc-ts-parser-ast",
  "/posts/2026-01-11-og-image",
  "/posts/2026-09-22-review",
  "/this-page-does-not-exist",
]);

// sitemap.xml に載っている全ページを対象にする。ページを足したら自動で対象に入る。
const sitemap = await (await fetch("/sitemap.xml")).text();
const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((m) => new URL(m[1] ?? "").pathname)
  .filter((p) => !EXCLUDED_PATHS.has(p));
// sitemap に載らない 404 画面も撮る。
paths.push("/this-page-does-not-exist");

function snapshotName(pathname: string, viewport: string): string {
  const slug = pathname === "/" ? "home" : pathname.slice(1).replaceAll("/", "__");
  return `${slug}-${viewport}`;
}

async function loadInFrame(pathname: string, width: number, height: number) {
  const iframe = document.createElement("iframe");
  iframe.style.cssText = `display:block;border:0;width:${width}px;height:${height}px`;
  document.body.append(iframe);
  await new Promise<void>((resolve) => {
    iframe.addEventListener("load", () => resolve(), { once: true });
    iframe.src = pathname;
  });
  const doc = iframe.contentDocument;
  if (!doc) throw new Error(`iframe の中身を読めません: ${pathname}`);

  // 描画を安定させる。アニメーションと WebGL の canvas（シェーダー）は撮るたびに変わる。
  const style = doc.createElement("style");
  style.textContent = `
    *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
    canvas { visibility: hidden !important; }
  `;
  doc.head.append(style);

  // 画像は loading="lazy" だと画面の外にある間は読み込まれず、完了を待つ処理が終わらない。
  // eager に切り替えて、ページ全体の画像を読み込ませる。
  for (const img of doc.images) img.loading = "eager";

  // Web フォントと画像の読み込みを待つ。ハイドレーションも終わらせるため少し待つ。
  await doc.fonts.ready;
  await Promise.all(
    [...doc.images].map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          }),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 800));

  // ページ全体が収まる高さにする。
  iframe.style.height = `${doc.documentElement.scrollHeight}px`;
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  iframe.style.height = `${doc.documentElement.scrollHeight}px`;
  return iframe;
}

for (const viewport of [DESKTOP, MOBILE]) {
  describe(viewport.name, () => {
    const targets = viewport === DESKTOP ? paths : paths.filter((p) => MOBILE_PATHS.has(p));
    test.each(targets)("%s", async (pathname) => {
      await page.viewport(viewport.width, viewport.height);
      const iframe = await loadInFrame(pathname, viewport.width, viewport.height);
      try {
        await expect
          .element(page.elementLocator(iframe))
          .toMatchScreenshot(snapshotName(pathname, viewport.name));
      } finally {
        iframe.remove();
      }
    });
  });
}
