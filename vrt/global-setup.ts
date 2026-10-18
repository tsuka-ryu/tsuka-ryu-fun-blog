import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

// VRT の対象のサイト（Void でビルドした本番の出力）を、`vite preview` で起動する。
// 先に `pnpm build` しておくこと。テストが終わったら止める。

export const PREVIEW_PORT = 4399;
const root = path.resolve(import.meta.dirname, "..");

let server: ChildProcess | undefined;

async function waitUntilReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // まだ起動していない。
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(
    `サイトが ${timeoutMs}ms 以内に起動しませんでした（${url}）。先に pnpm build してください`,
  );
}

export async function setup() {
  server = spawn(
    "pnpm",
    ["exec", "vite", "preview", "--port", String(PREVIEW_PORT), "--strictPort"],
    {
      cwd: root,
      stdio: "ignore",
      // pnpm の子プロセスごと止められるよう、独立したプロセスグループにする。
      detached: true,
    },
  );
  await waitUntilReady(`http://localhost:${PREVIEW_PORT}/`, 60_000);
}

export async function teardown() {
  if (server?.pid) process.kill(-server.pid, "SIGTERM");
}
