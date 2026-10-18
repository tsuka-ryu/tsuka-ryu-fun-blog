import { defineAuth } from "void/auth";

import { isAdminAccount } from "./src/site/admin-account.ts";

// 認証は GitHub ログインだけにする。管理者は自分 1 人なので、サインアップは「自分の GitHub アカウント」だけを通す。
// （環境変数 `ADMIN_GITHUB_ID` に、自分の GitHub の数値のユーザー ID を入れる。）
//
// セッションは D1（既定）に置く。管理者が 1 人で、公開ページは認証を通らない（ISR で返る）ので、規模の面で足りる。
// このファイルは起動時に、Vite を通さず素の Node で読まれる。import には拡張子 `.ts` が要る。
export default defineAuth(({ defaults, env }) => ({
  ...defaults,
  emailAndPassword: { enabled: false },
  databaseHooks: {
    account: {
      create: {
        // 管理者以外の GitHub アカウントは、アカウントの紐付けを作らせない（ログインが失敗する）。
        before: async (account) =>
          isAdminAccount(
            { providerId: account.providerId, accountId: String(account.accountId) },
            env.ADMIN_GITHUB_ID as string | undefined,
          ) && { data: account },
      },
    },
  },
}));
