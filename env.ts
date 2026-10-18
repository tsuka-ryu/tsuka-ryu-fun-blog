import { defineEnv, string } from "void/env";

export default defineEnv({
  // 管理 API をスクリプト（記事のインポートなど）から呼ぶための Bearer トークン。
  // 設定しなければ、トークンでの管理 API は常に 403 になる（本番で未設定のまま公開しても開かない）。
  ADMIN_API_TOKEN: string().optional(),
  // 管理者として認める GitHub の数値のユーザー ID。未設定なら、ブラウザからは誰も管理画面に入れない。
  ADMIN_GITHUB_ID: string().optional(),
  // 開発サーバーだけで、管理者の認可を省く（"1"）。本番のビルドでは無視される。
  ADMIN_DEV_BYPASS: string().optional(),
});
