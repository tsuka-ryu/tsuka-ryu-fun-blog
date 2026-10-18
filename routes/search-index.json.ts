import { buildSearchIndexJson } from "#lib/search.js";
import { defineHandler } from "void";

export const GET = defineHandler(
  () =>
    new Response(buildSearchIndexJson(), {
      headers: { "content-type": "application/json; charset=utf-8" },
    }),
);
