import { getAllPosts, summarize, type PostSummary } from "#content.js";
import { seoHead } from "#lib/seo.js";
import { defineHandler, defineHead } from "void";

export type Props = Readonly<{ posts: PostSummary[] }>;

export const loader = defineHandler<Props>(() => ({ posts: getAllPosts().map(summarize) }));

export const head = defineHead<Props>(() => seoHead({ path: "/" }));
