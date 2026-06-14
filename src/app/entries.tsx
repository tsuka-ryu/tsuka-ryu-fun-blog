import App, { routes } from "#app/App.js";

import type { RouteDefinition } from "@funstack/router";
import type { EntryDefinition } from "@funstack/static/entries";

// ルートツリーを再帰的に走査し、生成すべき全ページのフルパス一覧を集める。
function collectPaths(routeDefs: RouteDefinition[], prefix: string): string[] {
  const paths: string[] = [];
  for (const r of routeDefs) {
    const routePath = r.path;
    if (routePath === undefined) {
      // パスを持たないルート（例: Layout）。同じ prefix で再帰する。
      if (r.children) {
        paths.push(...collectPaths(r.children, prefix));
      }
    } else if (r.children) {
      // path と children の両方を持つ。prefix を延ばして再帰する。
      paths.push(...collectPaths(r.children, prefix + routePath));
    } else {
      // 末端ルート。フルパスを収集する。
      const fullPath = routePath === "/" ? prefix || "/" : prefix + routePath;
      paths.push(fullPath);
    }
  }
  return paths;
}

// ルートのパスを、SSR 時のパス（ssrPath）と出力 HTML ファイル名（outputPath）に変換する。
// 例: "/" → index.html、"/posts/x" → posts/x.html、"/*" → 404.html。
function toEntry(path: string): { ssrPath: string; outputPath: string } {
  if (path === "/*") {
    return { ssrPath: "/__404__", outputPath: "404.html" };
  }
  if (path === "/") {
    return { ssrPath: "/", outputPath: "index.html" };
  }
  // 出力ファイル名のため先頭のスラッシュを除去する。
  return { ssrPath: path, outputPath: `${path.slice(1)}.html` };
}

// @funstack/static のエントリ定義を生成する入口。ルート一覧を走査して、
// 各ページを「HTML シェル(Root) + アプリ(App) + 出力パス」の組に変換して返す。
export default function getEntries(): EntryDefinition[] {
  return collectPaths(routes, "").map((path) => {
    const { ssrPath, outputPath } = toEntry(path);
    return {
      path: outputPath,
      root: () => import("#app/Root.js"),
      app: <App ssrPath={ssrPath} />,
    };
  });
}
