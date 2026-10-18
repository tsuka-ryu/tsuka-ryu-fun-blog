import { slugify } from "#lib/toc.js";
import { transliterate } from "transliteration";

/**
 * frontmatter のタグを URL スラッグに変換する。
 * transliterate で日本語を romaji 化してから slugify でクリーンアップし、
 * ASCII の URL セーフなスラッグにする（例「RSSフィード」→ rsshuido、
 * 「Next.js」→ nextjs）。見出しのアンカー（extractToc）は日本語を残す方針なので
 * slugify を直接使い、タグだけ transliterate を噛ませてここで分岐する。
 */
export function tagSlug(tag: string): string {
  return slugify(transliterate(tag));
}
