import { voidReact } from "@void/react/plugin";
import { defineConfig } from "vite";
import { voidPlugin } from "void";

export default defineConfig({
  plugins: [voidPlugin(), voidReact()],
  // content/posts/*.md は ?raw で文字列として読む（src/content.ts）。ただし HMR で
  // 再読み込みされるときはクエリが落ちた素の .md として要求されることがあり、Vite が
  // JS として解析しようとして "invalid JS syntax" で落ちる。アセット扱いにしておくと
  // 解析対象から外れ、?raw の読み込みは従来どおり文字列を返す。
  assetsInclude: ["**/*.md"],
});
