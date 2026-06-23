/* ---------- models ---------- */

/**
 * Represents a Deepgram Speech-to-Text model.
 */
export interface DeepgramSttModel {
  name: string;
  canonical_name: string;
  architecture: string;
  languages: string[];
  version: string;
  uuid: string;
  batch: boolean;
  streaming: boolean;
  formatted_output: boolean;
}

/**
 * Represents a Deepgram Text-to-Speech model.
 */
export interface DeepgramTtsModel {
  name: string;
  canonical_name: string;
  architecture: string;
  languages: string[];
  version: string;
  uuid: string;
  metadata: {
    accent: string;
    age: string;
    color: string;
    image: string;
    sample: string;
    tags: string[];
    use_cases: string[];
  };
}

/**
 * Response from listing available models.
 */
export interface DeepgramListModelsResponse {
  stt: DeepgramSttModel[] | null;
  tts: DeepgramTtsModel[] | null;
}

/* ---------- projects ---------- */

/**
 * Represents a Deepgram Project.
 */
export interface DeepgramProject {
  project_id: string;
  name: string;
  /** Model Improvement Program opt-out flag (returned by Get a Project). */
  mip_opt_out?: boolean;
  created?: string;
  balance?: number;
}

/**
 * Generic confirmation message returned by several Manage endpoints
 * (e.g. update project, create invite, update scopes).
 */
export interface DeepgramMessageResponse {
  message: string;
}

/* ---------- keys ---------- */

/**
 * The API key portion of a project key record.
 */
export interface DeepgramApiKey {
  api_key_id: string;
  comment?: string;
  scopes?: string[];
  tags?: string[];
  expiration_date?: string;
  created?: string;
}

/**
 * The member a project key belongs to.
 */
export interface DeepgramKeyMember {
  member_id: string;
  email: string;
  first_name?: string;
  last_name?: string;
}

/**
 * Represents a Deepgram API Key as returned by list/get
 * (the secret value is never included here).
 */
export interface DeepgramKey {
  member: DeepgramKeyMember;
  api_key: DeepgramApiKey;
}

/**
 * Response returned when creating a key. This is the only time the secret
 * `key` value is exposed by the API.
 */
export interface DeepgramCreatedKey {
  api_key_id: string;
  key: string;
  comment?: string;
  scopes?: string[];
  tags?: string[];
  expiration_date?: string;
}

/* ---------- members ---------- */

/**
 * Represents a member of a Deepgram Project.
 */
export interface DeepgramMember {
  member_id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  scopes?: string[];
}

export type DeepgramScope = string;

/* ---------- invitations ---------- */

/**
 * Represents an invitation to join a Deepgram Project.
 */
export interface DeepgramInvitation {
  email: string;
  scope: string;
}

/* ---------- requests ---------- */

/**
 * Represents a usage request log entry.
 */
export interface DeepgramRequest {
  request_id: string;
  project_uuid?: string;
  created?: string;
  path?: string;
  api_key_id?: string;
  response?: Record<string, unknown> | null;
  code?: number;
  deployment?: string;
  callback?: string | null;
}

/* ---------- usage ---------- */

/**
 * A model entry returned by the usage fields endpoint.
 */
export interface DeepgramUsageFieldModel {
  name: string;
  language: string;
  version: string;
  model_id: string;
}

/**
 * Lists the features, models, tags and processing methods used by a project.
 */
export interface DeepgramUsageFields {
  tags: string[];
  models: DeepgramUsageFieldModel[];
  processing_methods: string[];
  features: string[];
}

/**
 * Time resolution descriptor used by usage responses.
 */
export interface DeepgramUsageResolution {
  units: string;
  amount: number;
}

/**
 * A single bucket of a usage breakdown response.
 */
export interface DeepgramUsageBreakdownResult {
  hours?: number;
  total_hours?: number;
  agent_hours?: number;
  tokens_in?: number;
  tokens_out?: number;
  tts_characters?: number;
  requests?: number;
  grouping?: Record<string, unknown>;
}

/**
 * Breakdown of usage statistics over a date range.
 */
export interface DeepgramUsageBreakdown {
  start: string;
  end: string;
  resolution: DeepgramUsageResolution;
  results: DeepgramUsageBreakdownResult[];
}

/* ---------- purchases ---------- */

/**
 * Represents a purchase or balance credit.
 */
export interface DeepgramPurchase {
  purchase_id: string;
  project_id: string;
  amount: number;
  created?: string;
}

/* ---------- balances ---------- */

/**
 * Represents an outstanding balance of a project.
 */
export interface DeepgramBalance {
  balance_id: string;
  amount: number;
  units?: string;
  purchase_order_id?: string;
}

/* ---------- temporary tokens ---------- */

/**
 * Response from granting a short-lived auth token (`POST /auth/grant`).
 */
export interface DeepgramGrantTokenResponse {
  access_token: string;
  expires_in: number;
}

/**
 * Return value of the `useDeepgramManagement` hook.
 * Provides access to various management APIs grouped by resource.
 */
export interface UseDeepgramManagementReturn {
  models: {
    list(includeOutdated?: boolean): Promise<DeepgramListModelsResponse>;
    get(modelId: string): Promise<DeepgramSttModel | DeepgramTtsModel>;
  };
  projects: {
    list(): Promise<DeepgramProject[]>;
    get(id: string): Promise<DeepgramProject>;
    delete(id: string): Promise<void>;
    patch(
      id: string,
      body: Record<string, unknown>
    ): Promise<DeepgramMessageResponse>;
    listModels(id: string): Promise<DeepgramListModelsResponse>;
    getModel(
      projectId: string,
      modelId: string
    ): Promise<DeepgramSttModel | DeepgramTtsModel>;
  };
  keys: {
    list(projectId: string): Promise<DeepgramKey[]>;
    create(
      projectId: string,
      body: Record<string, unknown>
    ): Promise<DeepgramCreatedKey>;
    get(projectId: string, keyId: string): Promise<DeepgramKey>;
    delete(projectId: string, keyId: string): Promise<void>;
  };
  members: {
    list(projectId: string): Promise<DeepgramMember[]>;
    delete(projectId: string, memberId: string): Promise<void>;
  };
  scopes: {
    list(projectId: string, memberId: string): Promise<DeepgramScope[]>;
    update(
      projectId: string,
      memberId: string,
      body: Record<string, unknown>
    ): Promise<DeepgramMessageResponse>;
  };
  invitations: {
    list(projectId: string): Promise<DeepgramInvitation[]>;
    create(
      projectId: string,
      body: Record<string, unknown>
    ): Promise<DeepgramMessageResponse>;
    delete(projectId: string, email: string): Promise<void>;
    leave(projectId: string): Promise<DeepgramMessageResponse>;
  };
  usage: {
    listRequests(projectId: string): Promise<DeepgramRequest[]>;
    getRequest(projectId: string, requestId: string): Promise<DeepgramRequest>;
    listFields(projectId: string): Promise<DeepgramUsageFields>;
    getBreakdown(projectId: string): Promise<DeepgramUsageBreakdown>;
  };
  purchases: {
    list(projectId: string): Promise<DeepgramPurchase[]>;
  };
  balances: {
    list(projectId: string): Promise<DeepgramBalance[]>;
    get(projectId: string, balanceId: string): Promise<DeepgramBalance>;
  };
  auth: {
    grant(body?: { ttl_seconds?: number }): Promise<DeepgramGrantTokenResponse>;
  };
}
