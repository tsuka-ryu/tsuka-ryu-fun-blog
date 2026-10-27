import { SITE_DESCRIPTION, SITE_TITLE, SITE_URL } from "#constants.js";
import { getAllPosts, type Post } from "#content.js";

// 記事ごとの素の Markdown（/posts/<slug>.md）と、その一覧（/llms.txt）をビルド時に生成する。
// HTML 版は本文が Suspense のストリーミングで後から差し込まれるため、JS を実行しない
// クローラーや AI には本文が空に見える。Markdown ならそれらでも確実に全文を読める。

function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).toString();
}

/** 記事 1 本分の Markdown。タイトル・日付・タグ・元記事の URL を冒頭に付ける。 */
export function buildPostMarkdown(post: Post): string {
  const { title, date, tags } = post.frontmatter;
  const meta = [`日付: ${date}`];
  if (tags?.length) meta.push(`タグ: ${tags.join(", ")}`);
  meta.push(`URL: ${absoluteUrl(`/posts/${post.slug}`)}`);
  return `# ${title}\n\n${meta.join("\n")}\n\n${post.body.trim()}\n`;
}

/** 記事 slug とその Markdown の組を全記事分返す。 */
export function buildPostMarkdowns(): { slug: string; markdown: string }[] {
  return getAllPosts().map((post) => ({ slug: post.slug, markdown: buildPostMarkdown(post) }));
}

/** llms.txt。サイトの概要と、各記事の Markdown への案内を載せる。 */
export function buildLlmsTxt(): string {
  const lines = getAllPosts().map((post) => {
    const { title, description } = post.frontmatter;
    const url = absoluteUrl(`/posts/${post.slug}.md`);
    return description ? `- [${title}](${url}): ${description}` : `- [${title}](${url})`;
  });
  return `# ${SITE_TITLE}\n\n> ${SITE_DESCRIPTION}\n\n## 記事\n\n${lines.join("\n")}\n`;
}
