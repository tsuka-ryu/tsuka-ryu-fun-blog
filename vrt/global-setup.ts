import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
// 認証のミドルウェアは全リクエストで GitHub の認証情報を要求するので、ダミーの値を渡す（ログインは使わない）。
const devVars: Record<string, string> = {
  ADMIN_API_TOKEN: token,
  AUTH_GITHUB_CLIENT_ID: "vrt",
  AUTH_GITHUB_CLIENT_SECRET: "vrt",
  BETTER_AUTH_SECRET: "vrt-secret-for-local-preview-only-0123456789",
};
const logFile = path.join(import.meta.dirname, ".vitest/preview.log");

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
 * 管理 API のトークンとダミーの認証情報を、ビルド成果物の `dist/ssr/.dev.vars`（`vite preview` のワーカーが読む環境変数）に書く。
 * `.env` はビルド時に `.dev.vars` へ写されるだけで、シェルの環境変数もプレビューには渡らない。
 * ビルドの出力を書き換えるだけなので、開発者の `.env` には触れない。
 */
function writeDevVars(): void {
  if (!existsSync(path.dirname(devVarsFile))) {
    throw new Error("dist/ssr がありません。先に pnpm build してください");
  }
  const lines = existsSync(devVarsFile) ? readFileSync(devVarsFile, "utf8").split("\n") : [];
  const keys = Object.keys(devVars);
  const kept = lines.filter(
    (line) => line.trim() !== "" && !keys.some((key) => line.startsWith(`${key}=`)),
  );
  const added = Object.entries(devVars).map(([key, value]) => `${key}=${value}`);
  writeFileSync(devVarsFile, `${[...kept, ...added].join("\n")}\n`);
}

function stopServer() {
  if (!server?.pid) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    // すでに終了している。
  }
  server = undefined;
}

let starting: Promise<void> | undefined;

/**
 * Vitest は、ブラウザモードの起動の途中で `setup` を 2 回呼ぶことがある（同じプロセスで数秒おき）。
 * 2 回目が状態を消してサーバーを壊さないよう、最初の起動の結果を使い回す。
 */
export function setup(): Promise<void> {
  starting ??= startSite().catch((error: unknown) => {
    // setup が失敗すると teardown は呼ばれないので、ここで止めないとポートを掴んだまま残る。
    stopServer();
    starting = undefined;
    throw error;
  });
  return starting;
}

async function startSite() {
  rmSync(stateDir, { recursive: true, force: true });
  writeDevVars();
  mkdirSync(path.dirname(logFile), { recursive: true });
  const logFd = openSync(logFile, "w");
  const env = { ...process.env, VOID_PERSIST_TO: stateDir, ADMIN_API_TOKEN: token };
  server = spawn(
    "pnpm",
    ["exec", "vite", "preview", "--port", String(PREVIEW_PORT), "--strictPort"],
    {
      cwd: root,
      env,
      // 起動に失敗したときに原因が追えるよう、出力をファイルに残す。
      stdio: ["ignore", logFd, logFd],
      // pnpm の子プロセスごと止められるよう、独立したプロセスグループにする。
      detached: true,
    },
  );
  closeSync(logFd);
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
  starting = undefined;
  stopServer();
  rmSync(stateDir, { recursive: true, force: true });
}
