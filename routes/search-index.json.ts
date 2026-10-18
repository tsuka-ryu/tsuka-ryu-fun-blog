import { r2Store } from "#site/r2-store.js";
import { readSearchIndex } from "#site/read.js";
import { defineHandler } from "void";

export const revalidate = 60 * 60 * 24 * 30;

export const GET = defineHandler(
  async () =>
    new Response(await readSearchIndex(r2Store), {
      headers: { "content-type": "application/json; charset=utf-8" },
    }),
);
