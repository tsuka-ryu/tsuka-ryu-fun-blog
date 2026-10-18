import { AdminPage } from "#admin/AdminPage.js";

import SignOutButton from "../../src/admin/SignOutButton.tsx" with { island: "load" };
import TagManager from "../../src/admin/TagManager.tsx" with { island: "load" };

import type { loader } from "./tags.server.ts";
import type { InferProps } from "void";

export default function AdminTags({ tags }: InferProps<typeof loader>) {
  return (
    <AdminPage signOut={<SignOutButton />}>
      <div className="page admin-tags-page">
        <h1>タグの管理</h1>
        <p>
          名前を変えると、そのタグが付いた公開中の記事も、同じ内容のまま公開し直されます。すでにあるタグの名前にすると統合されます。
        </p>
        <TagManager initialTags={tags} />
      </div>
    </AdminPage>
  );
}
