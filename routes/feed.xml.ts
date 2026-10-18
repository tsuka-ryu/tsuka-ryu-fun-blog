import { buildRssFeed } from "#lib/feed.js";
import { defineHandler } from "void";

export const GET = defineHandler(
  () =>
    new Response(buildRssFeed(), {
      headers: { "content-type": "application/rss+xml; charset=utf-8" },
    }),
);
