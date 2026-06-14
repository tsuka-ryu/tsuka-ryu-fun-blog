import { getAllPosts, getAllTags } from "#content.js";
import { SITE_DESCRIPTION, SITE_TITLE, SITE_URL } from "#constants.js";
import { dateInTokyo, nowInTokyo, toRfc822 } from "#lib/time.js";

// feed.xml（RSS 2.0）と sitemap.xml をビルド時に生成する。生成された HTML と
// 同じ出力ディレクトリに置けるよう、build entry（src/app/build.ts）から呼ばれる。
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

// 全記事を新しい順に並べた RSS 2.0 フィードを組み立てる。
export function buildRssFeed(): string {
  const lastBuildDate = toRfc822(nowInTokyo());

  const items = getAllPosts()
    .map((post) => {
      const url = absoluteUrl(`/posts/${post.slug}`);
      const pubDate = toRfc822(dateInTokyo(post.frontmatter.date));
      const categories = (post.frontmatter.tags ?? [])
        .map((tag) => `      <category>${escapeXml(tag)}</category>`)
        .join("\n");
      const description = post.frontmatter.description
        ? `\n      <description>${escapeXml(post.frontmatter.description)}</description>`
        : "";

      return `    <item>
      <title>${escapeXml(post.frontmatter.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${pubDate}</pubDate>${description}${
        categories ? `\n${categories}` : ""
      }
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
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
export function buildSitemap(): string {
  // TODO: /about・/tags はフェーズ6で作るページ前提のハードコード。ページ実装が
  // 出揃ったら、存在するルートから sitemap を生成する形に寄せて結合を解消する。
  const entries: Array<{ path: string; lastmod?: string }> = [
    { path: "/" },
    { path: "/about" },
    { path: "/tags" },
    ...getAllTags().map((tag) => ({ path: `/tags/${tag.slug}` })),
    ...getAllPosts().map((post) => ({
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
