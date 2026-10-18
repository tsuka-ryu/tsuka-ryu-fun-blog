import { useState } from "react";
import { auth } from "void/client";

// アイランドとして使うので、default export にする（named export は、アイランドとして読み込まれない）。
export default function LoginButton() {
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className="admin-primary"
        onClick={async () => {
          setError("");
          const result = await auth.signIn.social({ provider: "github", callbackURL: "/admin" });
          if (result?.error) setError("ログインを始められませんでした");
        }}
      >
        GitHub でログイン
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
