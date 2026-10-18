import { seoHead } from "#lib/seo.js";
import { defineHandler, defineHead } from "void";

// ログイン画面。誰でも開けるが、入れるのは自分の GitHub アカウントだけ（`auth.ts`）。
export const loader = defineHandler(() => ({}));

export const head = defineHead(() => seoHead({ title: "ログイン", noindex: true }));
