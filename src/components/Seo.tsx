import { TitleSync } from "#components/TitleSync.js";
import { SITE_DESCRIPTION, SITE_TITLE, SITE_URL } from "#constants.js";

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
  /** 記事タイトル（必須）。 */
  title: string;
  /** OG 画像の URL またはパス（必須）。 */
  image: string;
}

/** type で判別する SEO プロパティ。article は title / image 必須。 */
export type SeoProps = WebsiteSeo | ArticleSeo;

// OG カード（src/og/OgCard.tsx）の固定サイズ。og:image:width/height に出す。
const OG_IMAGE_WIDTH = 1200;
const OG_IMAGE_HEIGHT = 630;

// パス or URL を SITE_URL 基準の絶対 URL に解決する。すでに絶対 URL なら素通し。
function absoluteUrl(pathOrUrl?: string): string | undefined {
  if (!pathOrUrl) return undefined;
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  return new URL(pathOrUrl, SITE_URL).toString();
}

// 現在ページのドキュメントメタデータを出力する。React 19 は <title> / <meta> /
// <link> を <head> に巻き上げるため、静的生成された HTML でもクライアント遷移時でも
// 同じように効く。サイト名・説明・オリジンは constants.ts を単一の定義元とする。
export function Seo({ title, description, path, image, type = "website", noindex }: SeoProps) {
  const fullTitle = title ? `${title} — ${SITE_TITLE}` : SITE_TITLE;
  const desc = description ?? SITE_DESCRIPTION;
  const canonical = absoluteUrl(path);
  const ogImage = absoluteUrl(image);

  return (
    <>
      <title>{fullTitle}</title>
      {/* ソフト遷移後に document.title が前ページのまま残る問題を、クライアント側で
          焼き直して塞ぐ。共有シート（Web Share）が読むのは document.title のため。 */}
      <TitleSync title={fullTitle} />
      <meta name="description" content={desc} />
      {canonical && <link rel="canonical" href={canonical} />}
      {noindex && <meta name="robots" content="noindex" />}

      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={desc} />
      <meta property="og:type" content={type} />
      <meta property="og:site_name" content={SITE_TITLE} />
      <meta property="og:locale" content="ja_JP" />
      {canonical && <meta property="og:url" content={canonical} />}
      {ogImage && (
        <>
          <meta property="og:image" content={ogImage} />
          <meta property="og:image:width" content={String(OG_IMAGE_WIDTH)} />
          <meta property="og:image:height" content={String(OG_IMAGE_HEIGHT)} />
          <meta property="og:image:alt" content={fullTitle} />
        </>
      )}

      <meta name="twitter:card" content={ogImage ? "summary_large_image" : "summary"} />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={desc} />
      {ogImage && <meta name="twitter:image" content={ogImage} />}
    </>
  );
}
