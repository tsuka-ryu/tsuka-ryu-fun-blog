import { AdminPage } from "#admin/AdminPage.js";

import Editor from "../../../src/admin/Editor.tsx" with { island: "load" };
import SignOutButton from "../../../src/admin/SignOutButton.tsx" with { island: "load" };

import type { loader } from "./new.server.ts";
import type { InferProps } from "void";

export default function NewPost({ today }: InferProps<typeof loader>) {
  return (
    <AdminPage signOut={<SignOutButton />}>
      <Editor post={null} today={today} />
    </AdminPage>
  );
}
