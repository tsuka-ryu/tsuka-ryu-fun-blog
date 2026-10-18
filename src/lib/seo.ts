import { SITE_DESCRIPTION, SITE_TITLE, SITE_URL } from "#constants.js";

// ページの SEO 用の <head>（title / description / canonical / OGP / Twitter カード）を組み立てる。
// 各ページの head()（pages/**/*.server.ts）から呼ぶ。

/** website / article 共通の SEO プロパティ。 */
interface SeoBase {
  /** meta description。省略時はサイト共通の説明にフォールバック。 */
  description?: string;
  /** ルートのパス（例: "/posts/hello"）。canonical と og:url に使う。 */
  path?: string;
  /** true のとき noindex の robots タグを出力する。 */
  noindex?: boolean;
}

/** 通常ページ（ホーム / about / タグ等）。タイトル・画像は任意。 */
interface WebsiteSeo extends SeoBase {
  type?: "website";
  /** ページ固有のタイトル。サイト名と連結する。ホームでは省略。 */
  title?: string;
  /** OG 画像の URL またはパス。 */
  image?: string;
}

/** 記事ページ。OG カード（/og/<slug>.png）とタイトルが必ずあるので必須にする。 */
interface ArticleSeo extends SeoBase {
  type: "article";
  title: string;
  image: string;
}

export type SeoProps = WebsiteSeo | ArticleSeo;

export interface HeadMeta {
  name?: string;
  property?: string;
  content: string;
}

export interface SeoHead {
  title: string;
  meta: HeadMeta[];
  link: Array<{ rel: string; href: string }>;
}

const OG_IMAGE_WIDTH = 1200;
const OG_IMAGE_HEIGHT = 630;

function absoluteUrl(pathOrUrl?: string): string | undefined {
  if (!pathOrUrl) return undefined;
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  return new URL(pathOrUrl, SITE_URL).toString();
}

export function seoHead({
  title,
  description,
  path,
  image,
  type = "website",
  noindex,
}: SeoProps): SeoHead {
  const fullTitle = title ? `${title} — ${SITE_TITLE}` : SITE_TITLE;
  const desc = description ?? SITE_DESCRIPTION;
  const canonical = absoluteUrl(path);
  const ogImage = absoluteUrl(image);

  const meta: HeadMeta[] = [
    { name: "description", content: desc },
    { property: "og:title", content: fullTitle },
    { property: "og:description", content: desc },
    { property: "og:type", content: type },
    { property: "og:site_name", content: SITE_TITLE },
    { property: "og:locale", content: "ja_JP" },
    { name: "twitter:card", content: ogImage ? "summary_large_image" : "summary" },
    { name: "twitter:title", content: fullTitle },
    { name: "twitter:description", content: desc },
  ];
  if (noindex) meta.push({ name: "robots", content: "noindex" });
  if (canonical) meta.push({ property: "og:url", content: canonical });
  if (ogImage) {
    meta.push(
      { property: "og:image", content: ogImage },
      { property: "og:image:width", content: String(OG_IMAGE_WIDTH) },
      { property: "og:image:height", content: String(OG_IMAGE_HEIGHT) },
      { property: "og:image:alt", content: fullTitle },
      { name: "twitter:image", content: ogImage },
    );
  }
  return { title: fullTitle, meta, link: canonical ? [{ rel: "canonical", href: canonical }] : [] };
}
