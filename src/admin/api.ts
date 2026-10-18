import type { PostDetail } from "#site/posts.js";

// 管理 API（`/api/admin/*`）のクライアント。認可はブラウザのセッション（Cookie）で行われる。

export type { PostDetail };

export interface ApiError {
  status: number;
  error: string;
  /** 公開の検証に失敗したときの、診断の一覧。 */
  errors?: Array<{
    severity: string;
    ruleId: string;
    message: string;
    line: number;
    column: number;
  }>;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export async function api<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const headers = new Headers(init?.headers);
    if (init?.body) headers.set("content-type", "application/json");
    const response = await fetch(path, { ...init, headers });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.ok) return { ok: true, data: json as T };
    return {
      ok: false,
      error: {
        status: response.status,
        error: [json.error, json.reason].find((v) => typeof v === "string") ?? response.statusText,
        errors: json.errors as ApiError["errors"],
      },
    };
  } catch {
    return { ok: false, error: { status: 0, error: "ネットワークに接続できません" } };
  }
}

export interface SaveFields {
  title: string;
  description: string;
  date: string;
  tags: string[];
  body: string;
}

export const savePost = (slug: string, fields: SaveFields) =>
  api<{ ok: true }>(`/api/admin/posts/${slug}`, { method: "PUT", body: JSON.stringify(fields) });

export const publish = (slug: string) =>
  api<{ ok: true; warnings: unknown[]; revalidateError?: string }>(
    `/api/admin/posts/${slug}/publish`,
    { method: "POST" },
  );

export const unpublish = (slug: string) =>
  api<{ ok: true }>(`/api/admin/posts/${slug}/unpublish`, { method: "POST" });

export const deletePost = (slug: string) =>
  api<{ ok: true }>(`/api/admin/posts/${slug}`, { method: "DELETE" });

export const getPost = (slug: string) => api<PostDetail>(`/api/admin/posts/${slug}`);

export interface RevisionSummary {
  id: number;
  kind: "draft" | "snapshot" | "published";
  title: string;
  createdAt: string;
}

export const listRevisions = (slug: string) =>
  api<{ revisions: RevisionSummary[] }>(`/api/admin/posts/${slug}/revisions`);

export const getRevision = (slug: string, id: number) =>
  api<SaveFields & { id: number; kind: string; createdAt: string }>(
    `/api/admin/posts/${slug}/revisions/${id}`,
  );

export const restoreRevision = (slug: string, id: number) =>
  api<{ ok: true }>(`/api/admin/posts/${slug}/revisions/${id}/restore`, { method: "POST" });

export interface TagCount {
  name: string;
  slug: string;
  count: number;
}

export const listTags = () => api<{ tags: TagCount[] }>("/api/admin/tags");

export const renameTag = (from: string, to: string) =>
  api<{ renamed: string[]; failed: Array<{ slug: string; reason: string }> }>(
    "/api/admin/tags/rename",
    { method: "POST", body: JSON.stringify({ from, to }) },
  );
