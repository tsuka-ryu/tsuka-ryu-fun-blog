import { auth } from "void/client";

// アイランドとして使うので、default export にする（named export は、アイランドとして読み込まれない）。
export default function SignOutButton() {
  return (
    <button
      type="button"
      onClick={async () => {
        await auth.signOut();
        window.location.href = "/admin/login";
      }}
    >
      ログアウト
    </button>
  );
}
