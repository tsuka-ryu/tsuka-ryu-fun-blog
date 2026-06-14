import { ClientApp } from "#app/ClientApp.js";
import { Layout } from "#components/Layout.js";
import { getAllPosts, getAllTags } from "#content.js";
import { AboutPage } from "#pages/AboutPage.js";
import { HomePage } from "#pages/HomePage.js";
import { NotFoundPage } from "#pages/NotFoundPage.js";
import { PostPage } from "#pages/PostPage.js";
import { TagPage } from "#pages/TagPage.js";
import { TagsPage } from "#pages/TagsPage.js";
import { route } from "@funstack/router/server";
import { defer } from "@funstack/static/server";

import type { RouteDefinition } from "@funstack/router";

// content/posts/ 配下の Markdown 1 ファイルにつき 1 ルート。
const postRoutes = getAllPosts().map((post) =>
  route({
    path: `/posts/${post.slug}`,
    component: defer(<PostPage slug={post.slug} />, {
      name: `Post-${post.slug}`,
    }),
  }),
);

// タグごとに 1 ルート。記事の frontmatter から静的に生成する。
const tagRoutes = getAllTags().map((tag) =>
  route({
    path: `/tags/${tag.slug}`,
    component: defer(<TagPage slug={tag.slug} />, {
      name: `Tag-${tag.slug}`,
    }),
  }),
);

export const routes: RouteDefinition[] = [
  route({
    component: <Layout />,
    children: [
      route({ path: "/", component: defer(<HomePage />, { name: "HomePage" }) }),
      route({
        path: "/about",
        component: defer(<AboutPage />, { name: "AboutPage" }),
      }),
      route({
        path: "/tags",
        component: defer(<TagsPage />, { name: "TagsPage" }),
      }),
      ...tagRoutes,
      ...postRoutes,
      route({
        path: "/*",
        component: defer(<NotFoundPage />, { name: "NotFoundPage" }),
      }),
    ],
  }),
];

// アプリのルートコンポーネント。ルート定義 routes を ClientApp に渡して描画する。
// 各 HTML エントリ（entries.tsx）から、SSR 対象パス ssrPath 付きで呼び出される。
export default function App({ ssrPath }: { ssrPath?: string }) {
  return <ClientApp routes={routes} ssrPath={ssrPath} />;
}
