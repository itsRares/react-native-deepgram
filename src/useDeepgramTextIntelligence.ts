import { useRef, useCallback, useEffect } from 'react';
import type {
  UseDeepgramTextIntelligenceProps,
  UseDeepgramTextIntelligenceReturn,
} from './types';
import { DEEPGRAM_BASEURL } from './constants';
import { buildParams } from './helpers';

export function useDeepgramTextIntelligence({
  onBeforeAnalyze = () => {},
  onAnalyzeSuccess = () => {},
  onAnalyzeError = () => {},
  options = {},
}: UseDeepgramTextIntelligenceProps = {}): UseDeepgramTextIntelligenceReturn {
  const abortCtrl = useRef<AbortController | null>(null);

  const analyze = useCallback(
    async (input: { text?: string; url?: string }) => {
      onBeforeAnalyze();

      try {
        const apiKey = (globalThis as any).__DEEPGRAM_API_KEY__;
        if (!apiKey) throw new Error('Deepgram API key missing');

        const paramMap = {
          summarize: options.summarize,
          topics: options.topics,
          intents: options.intents,
          sentiment: options.sentiment,
          language: options.language,
          custom_topic: options.customTopic, // string or string[]
          custom_topic_mode: options.customTopicMode,
          callback: options.callback,
          callback_method: options.callbackMethod,
        };

        const params = buildParams(paramMap);

        const url = `${DEEPGRAM_BASEURL}/read?${params.toString()}`;
        abortCtrl.current?.abort();
        abortCtrl.current = new AbortController();

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Token ${apiKey}`,
          },
          body: JSON.stringify(input),
          signal: abortCtrl.current.signal,
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errText}`);
        }

        const json = await res.json();
        onAnalyzeSuccess(json);
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        onAnalyzeError(err);
      }
    },
    [
      onBeforeAnalyze,
      onAnalyzeSuccess,
      onAnalyzeError,
      options.customTopic,
      options.customTopicMode,
      options.summarize,
      options.topics,
      options.intents,
      options.sentiment,
      options.language,
      options.callback,
      options.callbackMethod,
    ]
  );

  useEffect(() => {
    return () => {
      abortCtrl.current?.abort();
    };
  }, []);

  return { analyze };
}
