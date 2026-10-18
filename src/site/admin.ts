import { r2Store } from "#site/r2-store.js";
import { getUser } from "void/auth";
import { db } from "void/db";
import { sql } from "void/db";
import { env } from "void/env";
import { revalidate } from "void/isr";

import type { Db } from "#site/posts.js";
import type { PublishDeps } from "#site/publish.js";

// 管理 API（`/api/admin/*`）と管理画面が使う、実環境の依存（D1・R2・ISR）と、認可。
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

export interface Admin {
  /** どの経路で認可されたか。 */
  via: "token" | "session" | "dev";
  name: string;
}

/**
 * 管理者として認可できれば、その情報を返す。経路は 3 つ。
 * - Bearer トークン（スクリプトから）。
 * - ブラウザのセッション。ログインしているだけでは足りず、そのアカウントが `ADMIN_GITHUB_ID` の GitHub
 *   アカウントであることを確かめる（認証のフックを通り抜けた別のユーザーが、管理画面に入れないように）。
 * - 開発サーバーだけ、`ADMIN_DEV_BYPASS=1` で認可を省く（本番のビルドでは、この分岐ごと取り除かれる）。
 */
export async function getAdmin(authorization: string | undefined): Promise<Admin | null> {
  if (hasAdminToken(authorization)) return { via: "token", name: "token" };
  if (import.meta.env.DEV && env.ADMIN_DEV_BYPASS === "1") return { via: "dev", name: "dev" };

  const user = getUser();
  const adminId = env.ADMIN_GITHUB_ID;
  if (!user || !adminId) return null;
  const rows = await db.all(
    sql`select 1 from account where userId = ${user.id} and providerId = 'github' and accountId = ${adminId} limit 1`,
  );
  return rows.length > 0 ? { via: "session", name: user.name } : null;
}

/** 管理 API の入口。認可できなければ、そのまま返す Response を返す。 */
export async function requireAdmin(c: {
  req: { header(name: string): string | undefined };
}): Promise<Response | null> {
  if (await getAdmin(c.req.header("authorization"))) return null;
  return Response.json({ error: "forbidden" }, { status: 403 });
}
