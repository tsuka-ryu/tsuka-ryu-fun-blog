import { r2Store } from "#site/r2-store.js";
import { db } from "void/db";
import { env } from "void/env";
import { revalidate } from "void/isr";

import type { Db } from "#site/posts.js";
import type { PublishDeps } from "#site/publish.js";

// 管理 API（`/api/admin/*`）が使う、実環境の依存（D1・R2・ISR）と、認可。
// 公開側からは import しない（D1 に触れるため。`public-boundary.test.ts` が守る）。

export function publishDeps(): PublishDeps {
  return {
    db: db as unknown as Db,
    store: r2Store,
    revalidate: (paths) => revalidate({ paths }),
    now: () => new Date(),
  };
}

/** 長さが違っても、比べるのにかかる時間が内容に依らないようにする文字列比較。 */
function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** `Authorization: Bearer <ADMIN_API_TOKEN>` が正しければ true。トークンが未設定なら常に false。 */
export function hasAdminToken(authorization: string | undefined): boolean {
  const token = env.ADMIN_API_TOKEN;
  if (!token || !authorization) return false;
  const match = /^Bearer (.+)$/.exec(authorization);
  return match !== null && constantTimeEqual(match[1]!, token);
}

/** 管理 API の入口。認可できなければ、そのまま返す Response を返す。 */
export function requireAdmin(c: {
  req: { header(name: string): string | undefined };
}): Response | null {
  if (hasAdminToken(c.req.header("authorization"))) return null;
  return Response.json({ error: "forbidden" }, { status: 403 });
}
