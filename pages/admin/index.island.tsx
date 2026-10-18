import { AdminPage } from "#admin/AdminPage.js";
import { formatDate } from "#lib/time.js";

import SignOutButton from "../../src/admin/SignOutButton.tsx" with { island: "load" };

import type { loader } from "./index.server.ts";
import type { InferProps } from "void";

function AdminIndex({ page, posts, hasMore }: InferProps<typeof loader>) {
  return (
    <div className="page admin-list">
      <h1>記事の管理</h1>
      <p>
        <a className="admin-button admin-primary" href="/admin/posts/new">
          新規作成
        </a>
      </p>
      {posts.length === 0 ? (
        <p>まだ記事がありません。</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>タイトル</th>
              <th>日付</th>
              <th>状態</th>
              <th>更新</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((post) => (
              <tr key={post.slug}>
                <td>
                  <a href={`/admin/posts/${post.slug}`}>{post.title || post.slug}</a>
                  <small className="admin-slug">{post.slug}</small>
                </td>
                <td>{formatDate(post.date)}</td>
                <td>{post.publishedAt ? "公開中" : "下書き"}</td>
                <td>
                  <time dateTime={post.updatedAt}>
                    {post.updatedAt.slice(0, 16).replace("T", " ")}
                  </time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="admin-pager">
        {page > 1 && <a href={`/admin?page=${page - 1}`}>← 前へ</a>}
        {hasMore && <a href={`/admin?page=${page + 1}`}>次へ →</a>}
      </p>
    </div>
  );
}

export default function AdminIndexWithFrame(props: InferProps<typeof loader>) {
  return (
    <AdminPage signOut={<SignOutButton />}>
      <AdminIndex {...props} />
    </AdminPage>
  );
}
