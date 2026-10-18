import { AdminPage } from "#admin/AdminPage.js";
import { NotFound } from "#components/NotFound.js";

import Editor from "../../../src/admin/Editor.tsx" with { island: "load" };
import SignOutButton from "../../../src/admin/SignOutButton.tsx" with { island: "load" };

import type { loader } from "./[slug].server.ts";
import type { InferProps } from "void";

export default function EditPost({ post, today }: InferProps<typeof loader>) {
  return (
    <AdminPage signOut={<SignOutButton />}>
      {post ? <Editor post={post} today={today} /> : <NotFound />}
    </AdminPage>
  );
}
