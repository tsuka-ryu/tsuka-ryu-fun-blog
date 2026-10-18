import { SITE_DESCRIPTION, SITE_TITLE, SITE_URL } from "#constants.js";
import { dateInTokyo, nowInTokyo, toRfc822 } from "#lib/time.js";
import { mdastToHtml } from "#markdown/html.js";

import type { Post, SiteIndex } from "#content.js";
import type { MdastNode } from "#markdown/types.js";

// feed.xml（RSS 2.0）と sitemap.xml を組み立てる。公開のたびに（#site/publish.js）、公開済みの記事から作り直して R2 に置く。
// 時刻は #lib/time.js 経由で JST 固定にする（pubDate / lastBuildDate は +0900）。

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char]!);
}

// サイト相対パスを本番オリジンに対して絶対 URL へ解決する。
function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).toString();
}

// 記事の AST を HTML 文字列へ描画する（RSS の content:encoded 用）。素の HTML で、shiki ハイライトは
// 通らないがリーダー表示には十分。RSS は外部リーダーで読まれるため、サイト相対 URL（/...）は絶対 URL に直す。
function renderContentHtml(root: MdastNode): string {
  return mdastToHtml(root, { origin: SITE_URL });
}

// CDATA セクションに安全に埋め込めるよう、本文中の `]]>` を分割する。
function cdata(value: string): string {
  return `<![CDATA[${value.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

// 全記事を新しい順に並べた RSS 2.0 フィードを組み立てる。
export function buildRssFeed(posts: readonly Post[], now: Date): string {
  const lastBuildDate = toRfc822(nowInTokyo(now));

  const items = posts
    .map((post) => {
      const url = absoluteUrl(`/posts/${post.slug}`);
      const pubDate = toRfc822(dateInTokyo(post.frontmatter.date));
      const categories = (post.frontmatter.tags ?? [])
        .map((tag) => `      <category>${escapeXml(tag)}</category>`)
        .join("\n");
      const description = post.frontmatter.description
        ? `\n      <description>${escapeXml(post.frontmatter.description)}</description>`
        : "";
      // 記事全文を HTML で埋め込む（content:encoded）。リーダーで全文が読める。
      const content = `\n      <content:encoded>${cdata(renderContentHtml(post.mdast))}</content:encoded>`;

      return `    <item>
      <title>${escapeXml(post.frontmatter.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${pubDate}</pubDate>${description}${content}${categories ? `\n${categories}` : ""}
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeXml(SITE_TITLE)}</title>
    <link>${absoluteUrl("/")}</link>
    <description>${escapeXml(SITE_DESCRIPTION)}</description>
    <language>ja</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${absoluteUrl("/feed.xml")}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
}

// ホーム / about / タグページ / 全記事を網羅した sitemap.xml を組み立てる。
export function buildSitemap(index: SiteIndex): string {
  const entries: Array<{ path: string; lastmod?: string }> = [
    { path: "/" },
    { path: "/about" },
    { path: "/tags" },
    ...index.tags.map((tag) => ({ path: `/tags/${tag.slug}` })),
    ...index.posts.map((post) => ({
      path: `/posts/${post.slug}`,
      lastmod: post.frontmatter.date,
    })),
  ];

  const urls = entries
    .map(({ path, lastmod }) => {
      const loc = `    <loc>${absoluteUrl(path)}</loc>`;
      const mod = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : "";
      return `  <url>\n${loc}${mod}\n  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}
