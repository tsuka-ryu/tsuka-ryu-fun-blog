import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

// VRT の対象のサイト（Void でビルドした本番の出力）を、`vite preview` で起動する。
// 先に `pnpm build` しておくこと。テストが終わったら止める。
//
// 公開ページは R2 のスナップショットを読むので、毎回まっさらなローカル状態（D1 / R2）を用意して、
// `content/posts/*.md` を管理 API で取り込んでから撮る。開発中のローカル状態（`.void/`）には触れず、
// `vrt/.state/` を使う（消してよい）。

export const PREVIEW_PORT = 4399;
const root = path.resolve(import.meta.dirname, "..");
const stateDir = path.join(import.meta.dirname, ".state");
const devVarsFile = path.join(root, "dist/ssr/.dev.vars");
const token = "vrt-token";

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

/**
 * 管理 API のトークンを、ビルド成果物の `dist/ssr/.dev.vars`（`vite preview` のワーカーが読む環境変数）に書く。
 * `.env` はビルド時に `.dev.vars` へ写されるだけで、シェルの環境変数もプレビューには渡らない。
 * ビルドの出力を書き換えるだけなので、開発者の `.env` には触れない。
 */
function writeAdminToken(): void {
  if (!existsSync(path.dirname(devVarsFile))) {
    throw new Error("dist/ssr がありません。先に pnpm build してください");
  }
  const lines = existsSync(devVarsFile) ? readFileSync(devVarsFile, "utf8").split("\n") : [];
  const kept = lines.filter((line) => line.trim() !== "" && !line.startsWith("ADMIN_API_TOKEN="));
  writeFileSync(devVarsFile, `${[...kept, `ADMIN_API_TOKEN=${token}`].join("\n")}\n`);
}

export async function setup() {
  rmSync(stateDir, { recursive: true, force: true });
  writeAdminToken();
  const env = { ...process.env, VOID_PERSIST_TO: stateDir, ADMIN_API_TOKEN: token };
  server = spawn(
    "pnpm",
    ["exec", "vite", "preview", "--port", String(PREVIEW_PORT), "--strictPort"],
    {
      cwd: root,
      env,
      stdio: "ignore",
      // pnpm の子プロセスごと止められるよう、独立したプロセスグループにする。
      detached: true,
    },
  );
  await waitUntilReady(`http://localhost:${PREVIEW_PORT}/`, 60_000);

  // プレビューが起動して保存先を記録したあとに、migration を流し、記事を取り込む。
  // 失敗したときだけ、コマンドの出力を見せる。
  const run = (command: string, args: string[]) => {
    try {
      execFileSync(command, args, { cwd: root, env, stdio: "pipe", encoding: "utf8" });
    } catch (error) {
      const { stdout, stderr } = error as { stdout?: string; stderr?: string };
      throw new Error(
        `${command} ${args.join(" ")} に失敗しました\n${stdout ?? ""}${stderr ?? ""}`,
      );
    }
  };
  run("pnpm", ["exec", "void", "db", "migrate"]);
  run("node", ["scripts/import-posts.ts", `http://localhost:${PREVIEW_PORT}`]);
}

export async function teardown() {
  if (server?.pid) process.kill(-server.pid, "SIGTERM");
  rmSync(stateDir, { recursive: true, force: true });
}
