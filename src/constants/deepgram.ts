export const DEEPGRAM_BASEURL = 'https://api.deepgram.com/v1';
export const DEEPGRAM_BASEWSS = 'wss://api.deepgram.com/v1';

export const DEEPGRAM_V2_BASEURL = 'https://api.deepgram.com/v2';
export const DEEPGRAM_V2_BASEWSS = 'wss://api.deepgram.com/v2';

export const DEEPGRAM_AGENT_URL = 'wss://agent.deepgram.com/v1/agent/converse';

const stripTrailingSlashes = (value: string): string =>
  value.replace(/\/+$/, '');

const readOverride = (key: string): string | undefined => {
  const value = (globalThis as any)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const deriveV2 = (v1: string): string =>
  /\/v1$/.test(v1) ? v1.replace(/\/v1$/, '/v2') : v1;

export const getBaseUrl = (): string =>
  stripTrailingSlashes(
    readOverride('__DEEPGRAM_BASE_URL__') ?? DEEPGRAM_BASEURL
  );

export const getBaseWss = (): string =>
  stripTrailingSlashes(
    readOverride('__DEEPGRAM_BASE_WSS__') ?? DEEPGRAM_BASEWSS
  );

export const getV2BaseUrl = (): string => {
  const override = readOverride('__DEEPGRAM_BASE_URL__');
  return stripTrailingSlashes(
    override ? deriveV2(override) : DEEPGRAM_V2_BASEURL
  );
};

export const getV2BaseWss = (): string => {
  const override = readOverride('__DEEPGRAM_BASE_WSS__');
  return stripTrailingSlashes(
    override ? deriveV2(override) : DEEPGRAM_V2_BASEWSS
  );
};

export const getAgentUrl = (): string =>
  readOverride('__DEEPGRAM_AGENT_URL__') ?? DEEPGRAM_AGENT_URL;
