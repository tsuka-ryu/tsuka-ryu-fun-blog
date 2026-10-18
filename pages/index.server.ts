import { type PostSummary } from "#content.js";
import { seoHead } from "#lib/seo.js";
import { r2Store } from "#site/r2-store.js";
import { readIndex } from "#site/read.js";
import { defineHandler, defineHead } from "void";

// 公開側は R2 のスナップショットだけを読む（D1 には触れない）。更新は、公開操作が ISR を無効化して反映する。
export const revalidate = 60 * 60 * 24 * 30;

export type Props = Readonly<{ posts: PostSummary[] }>;

export const loader = defineHandler<Props>(async () => ({
  posts: (await readIndex(r2Store)).posts,
}));

export const head = defineHead<Props>(() => seoHead({ path: "/" }));
