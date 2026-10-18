import { getAdmin } from "#site/admin.js";

// 管理画面のページ（`pages/admin/`）のローダーが使う認可。管理者でなければ、ログイン画面へ送る。

/** 管理者なら null、そうでなければ、返すべきリダイレクト。 */
export async function redirectUnlessAdmin(c: {
  req: { header(name: string): string | undefined };
  redirect(to: string): Response;
}): Promise<Response | null> {
  const admin = await getAdmin(c.req.header("authorization"));
  return admin ? null : c.redirect("/admin/login");
}
