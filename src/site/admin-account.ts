// 管理者として認める GitHub アカウントの判定。`auth.ts` が Node から直接読み込むので、依存を持たない素の TypeScript にする。

export interface LinkedAccount {
  providerId: string;
  /** プロバイダー側のユーザー ID（GitHub では数値のユーザー ID）。 */
  accountId: string;
}

/**
 * 管理者として認める GitHub のユーザー ID（`ADMIN_GITHUB_ID`）と一致するアカウントか。
 * ログイン名ではなく数値の ID で比べる（ログイン名は変更でき、手放した名前を別の人が取れるため）。
 * `ADMIN_GITHUB_ID` が未設定なら、誰も認めない。
 */
export function isAdminAccount(account: LinkedAccount, adminGithubId: string | undefined): boolean {
  return (
    Boolean(adminGithubId) && account.providerId === "github" && account.accountId === adminGithubId
  );
}
