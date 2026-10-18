import { seoHead } from "#lib/seo.js";
import { defineHandler, defineHead } from "void";

export const loader = defineHandler(() => ({}));

export const head = defineHead(() =>
  seoHead({
    title: "About me",
    description: "tsuka-ryu について。モダンなWeb技術が好きなフロントエンドエンジニアです。",
    path: "/about",
  }),
);
