import { Page } from "#components/Page.js";

import LoginButton from "../../src/admin/LoginButton.tsx" with { island: "load" };

export default function LoginPage() {
  return (
    <Page>
      <div className="admin">
        <div className="page admin-login">
          <h1>管理画面</h1>
          <p>この画面は、管理者の GitHub アカウントでだけ入れます。</p>
          <LoginButton />
        </div>
      </div>
    </Page>
  );
}
