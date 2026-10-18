import { r2Store } from "#site/r2-store.js";
import { readSitemap } from "#site/read.js";
import { defineHandler } from "void";

export const revalidate = 60 * 60 * 24 * 30;

export const GET = defineHandler(
  async () =>
    new Response(await readSitemap(r2Store), {
      headers: { "content-type": "application/xml; charset=utf-8" },
    }),
);
