import { defineMiddleware } from "void";

// 全ページで使える共有データ。現在のパスを渡して、ヘッダーのナビの現在地の表示に使う
// （アイランドのレイアウトは、リクエストのパスを自分では知らないため）。
declare module "void" {
  interface CloudContextVariables {
    shared: { pathname: string };
  }
}

export default defineMiddleware(async (c, next) => {
  c.set("shared", { pathname: new URL(c.req.url).pathname });
  await next();
});
