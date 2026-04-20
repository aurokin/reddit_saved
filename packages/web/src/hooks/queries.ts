import { type RequestInitJson, apiFetch, apiSearchParams } from "@/lib/api-client";
import type {
  AuthStatus,
  DbStats,
  PostRow,
  PostsListResponse,
  SearchResponse,
  SearchResult,
  SessionStatus,
  SyncProgressEvent,
  SyncState,
  Tag,
  TagWithCount,
} from "@/types";
/**
 * React Query hooks for the /api surface.
 * The plan calls for each hook in its own file, but they are trivial thin wrappers;
 * co-locating them in one module keeps query-key conventions visible in one place.
 */
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  type ReactNode,
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export const qk = {
  authStatus: ["auth", "status"] as const,
  sessionStatus: ["auth", "session"] as const,
  syncStatus: ["sync", "status"] as const,
  posts: (params: Record<string, unknown>) => ["posts", params] as const,
  post: (id: string) => ["post", id] as const,
  searchPosts: (params: Record<string, unknown>) => ["posts", "search", params] as const,
  tags: ["tags"] as const,
  postTags: (id: string) => ["post", id, "tags"] as const,
};

export function useAuthStatus(): UseQueryResult<AuthStatus> {
  return useQuery({
    queryKey: qk.authStatus,
    queryFn: () => apiFetch<AuthStatus>("/api/auth/status"),
    refetchInterval: (q) => (q.state.data?.authenticated === false ? 3_000 : false),
  });
}

export function useLoginMutation(): UseMutationResult<
  { started: boolean; authorizeUrl: string | null; testMode?: boolean },
  Error,
  { clientId?: string; clientSecret?: string; returnTo?: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      apiFetch<{ started: boolean; authorizeUrl: string | null; testMode?: boolean }>(
        "/api/auth/login",
        { method: "POST", json: body },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.authStatus });
    },
  });
}

export function useLogoutMutation(): UseMutationResult<{ ok: boolean }, Error, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.authStatus });
      qc.invalidateQueries({ queryKey: qk.sessionStatus });
    },
  });
}

/** Polls /api/auth/session — returns the cookie-session summary if the
 *  companion extension has handed cookies to the server. */
export function useSessionStatus(): UseQueryResult<SessionStatus> {
  return useQuery({
    queryKey: qk.sessionStatus,
    queryFn: () => apiFetch<SessionStatus>("/api/auth/session"),
    // Poll faster while waiting for the extension to connect; back off once linked.
    refetchInterval: (q) => (q.state.data?.connected ? 30_000 : 3_000),
  });
}

export function useDisconnectSessionMutation(): UseMutationResult<{ ok: boolean }, Error, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/api/auth/session", { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.sessionStatus });
      qc.invalidateQueries({ queryKey: qk.authStatus });
    },
  });
}

export function useReconnectSessionMutation(): UseMutationResult<{ ok: boolean }, Error, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/api/auth/session/reconnect", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.sessionStatus });
      qc.invalidateQueries({ queryKey: qk.authStatus });
    },
  });
}

export function usePosts(
  params: Record<string, string | number | boolean | undefined>,
): UseQueryResult<PostsListResponse> {
  return useQuery({
    queryKey: qk.posts(params),
    queryFn: () => apiFetch<PostsListResponse>(`/api/posts${apiSearchParams(params)}`),
  });
}

export function useSearchPosts(
  params: Record<string, string | number | boolean | undefined> & { q?: string },
): UseQueryResult<SearchResponse> {
  const enabled = !!(params.q && params.q.trim().length > 0);
  return useQuery({
    queryKey: qk.searchPosts(params),
    queryFn: () => apiFetch<SearchResponse>(`/api/posts/search${apiSearchParams(params)}`),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function usePost(id: string | undefined): UseQueryResult<PostRow> {
  return useQuery({
    queryKey: qk.post(id ?? ""),
    queryFn: () => apiFetch<PostRow>(`/api/posts/${id}`),
    enabled: !!id,
  });
}

export function useTags(): UseQueryResult<{ items: TagWithCount[] }> {
  return useQuery({
    queryKey: qk.tags,
    queryFn: () => apiFetch<{ items: TagWithCount[] }>("/api/tags"),
  });
}

export function useCreateTag(): UseMutationResult<Tag, Error, { name: string; color?: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      apiFetch<Tag>("/api/tags", { method: "POST", json: body } satisfies RequestInitJson),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.tags });
    },
  });
}

export function useRenameTag(): UseMutationResult<
  { ok: boolean },
  Error,
  { oldName: string; newName: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ oldName, newName }) =>
      apiFetch<{ ok: boolean }>(`/api/tags/${encodeURIComponent(oldName)}`, {
        method: "PATCH",
        json: { name: newName },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.tags });
      qc.invalidateQueries({ queryKey: ["posts"] });
      qc.invalidateQueries({ queryKey: ["post"] });
    },
  });
}

export function useDeleteTag(): UseMutationResult<{ ok: boolean }, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name) =>
      apiFetch<{ ok: boolean }>(`/api/tags/${encodeURIComponent(name)}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.tags });
      qc.invalidateQueries({ queryKey: ["posts"] });
      qc.invalidateQueries({ queryKey: ["post"] });
    },
  });
}

export function useAddPostTag(postId: string): UseMutationResult<{ ok: boolean }, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tag) =>
      apiFetch<{ ok: boolean }>(`/api/posts/${postId}/tags`, {
        method: "POST",
        json: { tag },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["posts"] });
      qc.invalidateQueries({ queryKey: qk.post(postId) });
      qc.invalidateQueries({ queryKey: qk.tags });
    },
  });
}

export function useRemovePostTag(
  postId: string,
): UseMutationResult<{ ok: boolean }, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tag) =>
      apiFetch<{ ok: boolean }>(`/api/posts/${postId}/tags/${encodeURIComponent(tag)}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["posts"] });
      qc.invalidateQueries({ queryKey: qk.post(postId) });
      qc.invalidateQueries({ queryKey: qk.tags });
    },
  });
}

export interface SyncStatusResponse extends SyncState {
  stats: DbStats;
}

export function useSyncStatus(): UseQueryResult<SyncStatusResponse> {
  return useQuery({
    queryKey: qk.syncStatus,
    queryFn: () => apiFetch<SyncStatusResponse>("/api/sync/status"),
    refetchInterval: 5_000,
  });
}

export function useUnsave(): UseMutationResult<
  { succeeded: string[]; failed: Array<{ id: string; error: string }>; cancelled: boolean },
  Error,
  { ids: string[]; confirm: true }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      apiFetch("/api/unsave", {
        method: "POST",
        json: body,
      }) as Promise<{
        succeeded: string[];
        failed: Array<{ id: string; error: string }>;
        cancelled: boolean;
      }>,
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: qk.syncStatus });
      qc.invalidateQueries({ queryKey: ["posts"] });
      for (const id of variables.ids) {
        qc.invalidateQueries({ queryKey: qk.post(id) });
      }
    },
  });
}

/**
 * SSE hook that streams sync progress. Reconciles via React state — callers
 * consume `events`/`isRunning` to render a progress indicator.
 */
type SyncStreamValue = {
  start: (type: string, full: boolean) => void;
  cancel: () => Promise<void>;
  isRunning: boolean;
  events: SyncProgressEvent[];
  latest: SyncProgressEvent | null;
  error: string | null;
};

const SyncStreamContext = createContext<SyncStreamValue | null>(null);

export function SyncStreamProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<SyncProgressEvent[]>([]);
  const [isRunning, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    return () => {
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, []);

  const closeSource = (): void => {
    sourceRef.current?.close();
    sourceRef.current = null;
  };

  const invalidateSyncQueries = async (): Promise<void> => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: qk.syncStatus }),
      qc.invalidateQueries({ queryKey: ["posts"] }),
      qc.invalidateQueries({ queryKey: ["post"] }),
    ]);
  };

  const start = (type: string, full: boolean): void => {
    if (sourceRef.current || isRunning) return;
    setEvents([]);
    setError(null);
    setRunning(true);

    // EventSource only supports GET, so the sync endpoint stays GET-backed and
    // relies on a server-side loopback/extension origin check.
    const params = new URLSearchParams({ type, full: String(full) });
    const es = new EventSource(`/api/sync/fetch?${params}`, { withCredentials: false });
    sourceRef.current = es;

    const handle = (phase: SyncProgressEvent["phase"]) => (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as Partial<SyncProgressEvent>;
        setEvents((prev) => [...prev, { phase, fetched: 0, ...data }]);
      } catch {
        /* ignore malformed */
      }
    };

    es.addEventListener("starting", handle("starting"));
    es.addEventListener("progress", handle("fetching"));
    es.addEventListener("complete", (e) => {
      handle("complete")(e);
      closeSource();
      setRunning(false);
      void invalidateSyncQueries();
    });
    es.addEventListener("incomplete", (e) => {
      handle("error")(e);
      closeSource();
      setRunning(false);
      void invalidateSyncQueries();
    });
    es.addEventListener("error", (e) => {
      const data = (e as MessageEvent).data;
      if (typeof data === "string") {
        try {
          const parsed = JSON.parse(data) as { message?: string };
          setError(parsed.message ?? "Sync failed");
        } catch {
          setError("Sync failed");
        }
      } else {
        setError("Sync connection error");
      }
      closeSource();
      setRunning(false);
    });
  };

  const cancel = async (): Promise<void> => {
    closeSource();
    await apiFetch<{ ok: boolean }>("/api/sync/cancel", { method: "POST" }).catch(() => {});
    setRunning(false);
    await invalidateSyncQueries();
  };

  const latest = events.length > 0 ? (events[events.length - 1] as SyncProgressEvent) : null;
  return createElement(
    SyncStreamContext.Provider,
    { value: { start, cancel, isRunning, events, latest, error } },
    children,
  );
}

export function useSyncStream(): SyncStreamValue {
  const value = useContext(SyncStreamContext);
  if (!value) {
    throw new Error("useSyncStream must be used within a SyncStreamProvider");
  }
  return value;
}

export async function downloadExport(
  format: "json" | "csv" | "markdown",
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<void> {
  const url = `/api/export${apiSearchParams({ ...params, format })}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Export failed: ${res.status} ${res.statusText}`);
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  link.download = match?.[1] ?? `reddit-saved.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

export type { SearchResult };
