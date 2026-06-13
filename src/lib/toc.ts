import type { MdastNode } from "#markdown/types.js";

/** 記事の目次(TOC)の 1 エントリ。 */
export interface TocEntry {
  /** 見出しレベル（1〜6）。 */
  depth: number;
  /** プレーンテキストの見出しラベル。 */
  text: string;
  /** アンカー id。描画された見出しに付く id と一致する。 */
  id: string;
}

/** 目次に載せる見出しレベルの範囲。 */
const TOC_MIN_DEPTH = 2;
const TOC_MAX_DEPTH = 3;

/** ノードとその子孫の可視テキストを連結する。 */
function nodeText(node: MdastNode): string {
  if (node.value) return node.value;
  if (node.children) return node.children.map(nodeText).join("");
  return "";
}

// 見出しテキストをアンカー id 用のスラッグに変換する。
// Unicode の文字・数字は残す（日本語見出しも読める形に保つ）ため、
// それ以外はハイフンに畳む。
export function slugify(text: string): string {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

// mdast ツリーを走査し、すべての見出しノードに一意な id を付与（ツリーを
// その場で書き換え、レンダラーと目次で同じアンカーを共有させる）したうえで、
// TOC_MIN_DEPTH〜TOC_MAX_DEPTH の範囲の見出しから目次を返す。
// ビルド時に content.ts で Markdown のパースと並んで実行される。
export function extractToc(root: MdastNode): TocEntry[] {
  const entries: TocEntry[] = [];
  const seen = new Map<string, number>();

  const walk = (node: MdastNode): void => {
    if (node.type === "heading") {
      const text = nodeText(node).trim();
      const base = slugify(text);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      const id = count === 0 ? base : `${base}-${count}`;
      node.id = id;

      const depth = node.depth ?? 1;
      if (depth >= TOC_MIN_DEPTH && depth <= TOC_MAX_DEPTH) {
        entries.push({ depth, text, id });
      }
    }
    node.children?.forEach(walk);
  };

  walk(root);
  return entries;
}
