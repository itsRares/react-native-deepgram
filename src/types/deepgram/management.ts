/* ---------- models ---------- */
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

export interface DeepgramListModelsResponse {
  stt: DeepgramSttModel[] | null;
  tts: DeepgramTtsModel[] | null;
}

export interface DeepgramProject {
  project_id: string;
  name: string;
  created?: string;
  balance?: number;
}

export interface DeepgramKey {
  key_id: string;
  project_id: string;
  comment?: string;
  scopes?: string[];
  created?: string;
}

export interface DeepgramMember {
  member_id: string;
  email: string;
  role: string;
  invited?: boolean;
}

export type DeepgramScope = string;

export interface DeepgramInvitation {
  invitation_id: string;
  project_id: string;
  email: string;
  status?: string;
  created?: string;
}

export interface DeepgramRequest {
  request_id: string;
  project_id: string;
  model_id?: string;
  created?: string;
}

export interface DeepgramUsageField {
  field: string;
  description?: string;
}

export interface DeepgramUsageBreakdown {
  total: number;
  breakdown: Record<string, number>;
}

export interface DeepgramPurchase {
  purchase_id: string;
  project_id: string;
  amount: number;
  created?: string;
}

export interface DeepgramBalance {
  balance_id: string;
  project_id: string;
  balance: number;
  currency?: string;
}

export interface UseDeepgramManagementReturn {
  models: {
    list(includeOutdated?: boolean): Promise<DeepgramListModelsResponse>;
    get(modelId: string): Promise<DeepgramSttModel | DeepgramTtsModel>;
  };
  projects: {
    list(): Promise<DeepgramProject[]>;
    get(id: string): Promise<DeepgramProject>;
    delete(id: string): Promise<void>;
    patch(id: string, body: Record<string, unknown>): Promise<DeepgramProject>;
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
    ): Promise<DeepgramKey>;
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
    ): Promise<DeepgramScope[]>;
  };
  invitations: {
    list(projectId: string): Promise<DeepgramInvitation[]>;
    create(
      projectId: string,
      body: Record<string, unknown>
    ): Promise<DeepgramInvitation>;
    delete(projectId: string, invitationId: string): Promise<void>;
    leave(projectId: string): Promise<void>;
  };
  usage: {
    listRequests(projectId: string): Promise<DeepgramRequest[]>;
    getRequest(projectId: string, requestId: string): Promise<DeepgramRequest>;
    listFields(projectId: string): Promise<DeepgramUsageField[]>;
    getBreakdown(projectId: string): Promise<DeepgramUsageBreakdown>;
  };
  purchases: {
    list(projectId: string): Promise<DeepgramPurchase[]>;
  };
  balances: {
    list(projectId: string): Promise<DeepgramBalance[]>;
    get(projectId: string, balanceId: string): Promise<DeepgramBalance>;
  };
}
