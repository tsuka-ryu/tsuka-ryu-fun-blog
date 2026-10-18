import { buildSitemap } from "#lib/feed.js";
import { defineHandler } from "void";

export const GET = defineHandler(
  () =>
    new Response(buildSitemap(), {
      headers: { "content-type": "application/xml; charset=utf-8" },
    }),
);
