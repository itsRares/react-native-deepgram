import { useRef, useCallback, useEffect, useMemo } from 'react';
import type {
  DeepgramSttModel,
  DeepgramTtsModel,
  DeepgramListModelsResponse,
  DeepgramProject,
  DeepgramMessageResponse,
  DeepgramKey,
  DeepgramCreatedKey,
  DeepgramMember,
  DeepgramScope,
  DeepgramInvitation,
  DeepgramRequest,
  DeepgramUsageFields,
  DeepgramUsageBreakdown,
  DeepgramPurchase,
  DeepgramBalance,
  DeepgramGrantTokenResponse,
  UseDeepgramManagementReturn,
} from './types/deepgram';
import { getBaseUrl } from './constants';
import { dgPath } from './helpers';

/**
 * Append a query‐param object to a path:
 * buildUrl('/projects/123/requests', { page:2, after:'…' })
 *   → '/projects/123/requests?page=2&after=…'
 */
function buildUrl(path: string, query?: Record<string, any>): string {
  if (!query) return path;
  const qp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v != null) qp.set(k, String(v));
  }
  const qs = qp.toString();
  return qs ? `${path}?${qs}` : path;
}

export function useDeepgramManagement(): UseDeepgramManagementReturn {
  const controllersRef = useRef<Set<AbortController>>(new Set());

  const dgRequest = useCallback(
    async <T>(path: string, init: RequestInit = {}): Promise<T> => {
      const ctrl = new AbortController();
      controllersRef.current.add(ctrl);

      const key = (globalThis as any).__DEEPGRAM_API_KEY__;
      if (!key) throw new Error('Deepgram API key missing');

      try {
        const res = await fetch(`${getBaseUrl()}${path}`, {
          signal: ctrl.signal,
          headers: { Authorization: `Token ${key}`, ...(init.headers || {}) },
          ...init,
        });
        if (!res.ok) throw new Error(`DG ${res.status}: ${await res.text()}`);
        return (await res.json()) as T;
      } finally {
        controllersRef.current.delete(ctrl);
      }
    },
    []
  );

  /** ------------------- MODELS ------------------- */
  const models = useMemo(
    () => ({
      list: (includeOutdated = false, query?: Record<string, any>) => {
        const mergedQuery = includeOutdated
          ? { ...query, include_outdated: true }
          : query;
        return dgRequest<DeepgramListModelsResponse>(
          buildUrl(dgPath('models'), mergedQuery)
        );
      },
      get: (modelId: string, query?: Record<string, any>) =>
        dgRequest<DeepgramSttModel | DeepgramTtsModel>(
          buildUrl(dgPath('models', modelId), query)
        ),
    }),
    [dgRequest]
  );

  /** ------------------- PROJECTS ------------------- */
  const projects = useMemo(
    () => ({
      list: async (query?: Record<string, any>) => {
        const res = await dgRequest<{ projects: DeepgramProject[] }>(
          buildUrl(dgPath('projects'), query)
        );
        return res.projects;
      },

      get: (id: string, query?: Record<string, any>) =>
        dgRequest<DeepgramProject>(buildUrl(dgPath('projects', id), query)),

      delete: (id: string, query?: Record<string, any>) =>
        dgRequest<void>(buildUrl(dgPath('projects', id), query), {
          method: 'DELETE',
        }),

      patch: (
        id: string,
        body: Record<string, unknown>,
        query?: Record<string, any>
      ) =>
        dgRequest<DeepgramMessageResponse>(
          buildUrl(dgPath('projects', id), query),
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        ),

      listModels: (id: string, query?: Record<string, any>) =>
        dgRequest<DeepgramListModelsResponse>(
          buildUrl(dgPath('projects', id, 'models'), query)
        ),

      getModel: (pid: string, mid: string, query?: Record<string, any>) =>
        dgRequest<DeepgramSttModel | DeepgramTtsModel>(
          buildUrl(dgPath('projects', pid, 'models', mid), query)
        ),
    }),
    [dgRequest]
  );

  /** ------------------- KEYS ------------------- */
  const keys = useMemo(
    () => ({
      list: async (pid: string, query?: Record<string, any>) => {
        const res = await dgRequest<{ api_keys: DeepgramKey[] }>(
          buildUrl(dgPath('projects', pid, 'keys'), query)
        );
        return res.api_keys;
      },
      create: (pid: string, body: Record<string, unknown>) =>
        dgRequest<DeepgramCreatedKey>(dgPath('projects', pid, 'keys'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      get: async (pid: string, kid: string, query?: Record<string, any>) => {
        const res = await dgRequest<{ item: DeepgramKey }>(
          buildUrl(dgPath('projects', pid, 'keys', kid), query)
        );
        return res.item;
      },
      delete: (pid: string, kid: string, query?: Record<string, any>) =>
        dgRequest<void>(buildUrl(dgPath('projects', pid, 'keys', kid), query), {
          method: 'DELETE',
        }),
    }),
    [dgRequest]
  );

  /** ------------------- MEMBERS ------------------- */
  const members = useMemo(
    () => ({
      list: async (pid: string, query?: Record<string, any>) => {
        const res = await dgRequest<{ members: DeepgramMember[] }>(
          buildUrl(dgPath('projects', pid, 'members'), query)
        );
        return res.members;
      },
      delete: (pid: string, mid: string) =>
        dgRequest<void>(dgPath('projects', pid, 'members', mid), {
          method: 'DELETE',
        }),
    }),
    [dgRequest]
  );

  /** ------------------- SCOPES ------------------- */
  const scopes = useMemo(
    () => ({
      list: async (pid: string, mid: string, query?: Record<string, any>) => {
        const res = await dgRequest<{ scopes: DeepgramScope[] }>(
          buildUrl(dgPath('projects', pid, 'members', mid, 'scopes'), query)
        );
        return res.scopes;
      },
      update: (pid: string, mid: string, body: Record<string, unknown>) =>
        dgRequest<DeepgramMessageResponse>(
          dgPath('projects', pid, 'members', mid, 'scopes'),
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        ),
    }),
    [dgRequest]
  );

  /** ------------------- INVITATIONS ------------------- */
  const invitations = useMemo(
    () => ({
      list: async (pid: string, query?: Record<string, any>) => {
        const res = await dgRequest<{ invites: DeepgramInvitation[] }>(
          buildUrl(dgPath('projects', pid, 'invites'), query)
        );
        return res.invites;
      },
      create: (pid: string, body: Record<string, unknown>) =>
        dgRequest<DeepgramMessageResponse>(dgPath('projects', pid, 'invites'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      delete: (pid: string, email: string) =>
        dgRequest<void>(dgPath('projects', pid, 'invites', email), {
          method: 'DELETE',
        }),
      leave: (pid: string) =>
        dgRequest<DeepgramMessageResponse>(dgPath('projects', pid, 'leave'), {
          method: 'DELETE',
        }),
    }),
    [dgRequest]
  );

  /** ------------------- USAGE ------------------- */
  const usage = useMemo(
    () => ({
      listRequests: async (pid: string, query?: Record<string, any>) => {
        const res = await dgRequest<{ requests: DeepgramRequest[] }>(
          buildUrl(dgPath('projects', pid, 'requests'), query)
        );
        return res.requests;
      },
      getRequest: async (
        pid: string,
        rid: string,
        query?: Record<string, any>
      ) => {
        const res = await dgRequest<{ request: DeepgramRequest }>(
          buildUrl(dgPath('projects', pid, 'requests', rid), query)
        );
        return res.request;
      },
      listFields: (pid: string, query?: Record<string, any>) =>
        dgRequest<DeepgramUsageFields>(
          buildUrl(dgPath('projects', pid, 'usage', 'fields'), query)
        ),
      getBreakdown: (pid: string, query?: Record<string, any>) =>
        dgRequest<DeepgramUsageBreakdown>(
          buildUrl(dgPath('projects', pid, 'usage', 'breakdown'), query)
        ),
    }),
    [dgRequest]
  );

  /** ------------------- PURCHASES ------------------- */
  const purchases = useMemo(
    () => ({
      list: (pid: string, query?: Record<string, any>) =>
        dgRequest<DeepgramPurchase[]>(
          buildUrl(dgPath('projects', pid, 'purchases'), query)
        ),
    }),
    [dgRequest]
  );

  /** ------------------- BALANCES ------------------- */
  const balances = useMemo(
    () => ({
      list: async (pid: string, query?: Record<string, any>) => {
        const res = await dgRequest<{ balances: DeepgramBalance[] }>(
          buildUrl(dgPath('projects', pid, 'balances'), query)
        );
        return res.balances;
      },
      get: (pid: string, bid: string, query?: Record<string, any>) =>
        dgRequest<DeepgramBalance>(
          buildUrl(dgPath('projects', pid, 'balances', bid), query)
        ),
    }),
    [dgRequest]
  );

  /** ------------------- AUTH (TEMPORARY TOKENS) ------------------- */
  const auth = useMemo(
    () => ({
      grant: (body?: { ttl_seconds?: number }) =>
        dgRequest<DeepgramGrantTokenResponse>(dgPath('auth', 'grant'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body ?? {}),
        }),
    }),
    [dgRequest]
  );

  useEffect(() => {
    const controllers = controllersRef.current;
    return () => {
      controllers.forEach((c) => c.abort());
      controllers.clear();
    };
  }, []);

  return {
    models,
    projects,
    keys,
    members,
    scopes,
    invitations,
    usage,
    purchases,
    balances,
    auth,
  };
}
