import { SITE_TITLE } from "#constants.js";
import { formatDate } from "#lib/time.js";

import type { PostFrontmatter } from "#content.js";
import type { OgCardProps } from "#og/OgCard.js";

// 記事の OG 画像（SNS のカード）に載せる内容。公開時と、取りこぼしを補う初回アクセスの両方で同じにする。

export function ogInput(frontmatter: PostFrontmatter): OgCardProps {
  return {
    siteName: SITE_TITLE,
    title: frontmatter.title,
    // 補助行は「タグ · 日付」。
    meta: [...(frontmatter.tags ?? []), formatDate(frontmatter.date)].join("  ·  "),
  };
}
