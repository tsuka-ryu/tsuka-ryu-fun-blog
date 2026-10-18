import { defineEnv, string } from "void/env";

export default defineEnv({
  // 管理 API をスクリプト（記事のインポートなど）から呼ぶための Bearer トークン。
  // 設定しなければ、トークンでの管理 API は常に 403 になる（本番で未設定のまま公開しても開かない）。
  ADMIN_API_TOKEN: string().optional(),
});
