import { defineMiddleware } from "void";

// ページの loader は、レスポンスのステータスを変えられない（`c.status(404)` が効かない）。
// 存在しないページは、loader が `x-not-found` ヘッダーを付けて返し、ここで 404 に書き換える。
export const NOT_FOUND_HEADER = "x-not-found";

export default defineMiddleware(async (c, next) => {
  await next();
  if (c.res.headers.get(NOT_FOUND_HEADER)) {
    const headers = new Headers(c.res.headers);
    headers.delete(NOT_FOUND_HEADER);
    c.res = new Response(c.res.body, { status: 404, headers });
  }
});
