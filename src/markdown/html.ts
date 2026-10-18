import type { MdastNode } from "#markdown/types.js";

// AST を HTML の文字列にする。RSS の content:encoded のように、React を使えない（使いたくない）
// 場面向けの素朴な描画で、シンタックスハイライトは通さない。サイトの表示は components.tsx。

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escapeHtml = (value: string) => value.replace(/[&<>"]/g, (c) => ESCAPES[c] ?? c);

export interface HtmlOptions {
  /** 指定すると、`/` で始まるサイト内の URL を、このオリジン付きの絶対 URL に直す（外部のリーダーで読むため）。 */
  origin?: string;
}

export function mdastToHtml(root: MdastNode, options: HtmlOptions = {}): string {
  const url = (value: string) =>
    options.origin && value.startsWith("/") && !value.startsWith("//")
      ? `${options.origin}${value}`
      : value;

  const children = (nodes: MdastNode[]): string => nodes.map(render).join("");

  function render(node: MdastNode): string {
    switch (node.type) {
      case "root":
        return children(node.children);
      case "heading":
        return `<h${node.depth}${node.id ? ` id="${escapeHtml(node.id)}"` : ""}>${children(node.children)}</h${node.depth}>\n`;
      case "paragraph":
        return `<p>${children(node.children)}</p>\n`;
      case "text":
        return escapeHtml(node.value);
      case "strong":
        return `<strong>${children(node.children)}</strong>`;
      case "emphasis":
        return `<em>${children(node.children)}</em>`;
      case "delete":
        return `<del>${children(node.children)}</del>`;
      case "inlineCode":
        return `<code>${escapeHtml(node.value)}</code>`;
      case "link":
        return `<a href="${escapeHtml(url(node.url))}"${node.title ? ` title="${escapeHtml(node.title)}"` : ""}>${children(node.children)}</a>`;
      case "image":
        return `<img src="${escapeHtml(url(node.url))}" alt="${escapeHtml(node.alt ?? "")}"${node.title ? ` title="${escapeHtml(node.title)}"` : ""} />`;
      case "list": {
        const tag = node.ordered ? "ol" : "ul";
        const start =
          node.ordered && node.start != null && node.start !== 1 ? ` start="${node.start}"` : "";
        return `<${tag}${start}>\n${children(node.children)}</${tag}>\n`;
      }
      case "listItem":
        return `<li>${children(node.children)}</li>\n`;
      case "blockquote":
        return `<blockquote>\n${children(node.children)}</blockquote>\n`;
      case "code": {
        const lang = node.lang ? ` class="language-${escapeHtml(node.lang)}"` : "";
        return `<pre><code${lang}>${escapeHtml(node.value)}</code></pre>\n`;
      }
      case "thematicBreak":
        return "<hr />\n";
      case "break":
        return "<br />\n";
      case "table": {
        const [head, ...body] = node.children;
        const align = node.align ?? [];
        const cell = (tag: "th" | "td", row: { children: MdastNode[] }) =>
          row.children
            .map(
              (c, i) =>
                `<${tag}${align[i] ? ` style="text-align:${align[i]}"` : ""}>${children("children" in c ? c.children : [])}</${tag}>`,
            )
            .join("");
        return (
          `<table>\n` +
          (head ? `<thead>\n<tr>${cell("th", head)}</tr>\n</thead>\n` : "") +
          `<tbody>\n${body.map((row) => `<tr>${cell("td", row)}</tr>\n`).join("")}</tbody>\n</table>\n`
        );
      }
      case "tableRow":
      case "tableCell":
        return children(node.children);
      default:
        return "";
    }
  }

  return render(root);
}
