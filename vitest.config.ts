import { defineConfig } from "vitest/config";

// 単体テスト（Node）の設定。ブラウザのスクリーンショットテストは vrt/vitest.config.ts。
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "vrt/baseline-urls.test.ts"],
    environment: "node",
  },
});
