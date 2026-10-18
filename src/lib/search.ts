import type { Post } from "#content.js";
import type { SearchDocument } from "#lib/search-query.js";
import type { MdastNode } from "#markdown/types.js";

// クライアント検索の索引（/search-index.json）を作る。検索そのものは、ブラウザで動く
// #lib/search-query.js。

function collectContent(root: MdastNode): { body: string; headings: string[]; code: string[] } {
  const bodyParts: string[] = [];
  const headings: string[] = [];
  const code: string[] = [];

  const textOf = (node: MdastNode): string => {
    if ("value" in node) return node.value;
    if ("children" in node) return node.children.map(textOf).join("");
    return "";
  };

  const walk = (node: MdastNode): void => {
    if (node.type === "code") {
      code.push(node.value);
      return;
    }
    if (node.type === "heading") {
      headings.push(textOf(node).trim());
      return;
    }
    if (node.type === "text" || node.type === "inlineCode") {
      bodyParts.push(node.value);
    }
    if ("children" in node) node.children.forEach(walk);
  };

  walk(root);
  return { body: bodyParts.join(" "), headings, code };
}

export function buildSearchDocuments(posts: readonly Post[]): SearchDocument[] {
  return posts.map((post): SearchDocument => {
    const { body, headings, code } = collectContent(post.mdast);
    return {
      id: post.slug,
      title: post.frontmatter.title,
      url: `/posts/${post.slug}`,
      headings,
      body,
      code: code.join("\n"),
    };
  });
}

export function buildSearchIndexJson(posts: readonly Post[]): string {
  return JSON.stringify(buildSearchDocuments(posts));
}
