import { useRef, useCallback, useEffect } from 'react';
import type {
  UseDeepgramTextIntelligenceProps,
  UseDeepgramTextIntelligenceReturn,
  DeepgramTextIntelligenceInput,
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

  const {
    summarize,
    topics,
    customTopic,
    customTopicMode,
    intents,
    customIntent,
    customIntentMode,
    sentiment,
    language,
    callback,
    callbackMethod,
  } = options;

  const analyze = useCallback(
    async (input: DeepgramTextIntelligenceInput) => {
      onBeforeAnalyze();

      try {
        const apiKey = (globalThis as any).__DEEPGRAM_API_KEY__;
        if (!apiKey) throw new Error('Deepgram API key missing');

        const { text, url: sourceUrl } = input;

        if (!text && !sourceUrl) {
          throw new Error(
            'Either `text` or `url` is required to analyze content.'
          );
        }

        const paramMap = {
          summarize,
          topics,
          intents,
          sentiment,
          language,
          custom_topic: customTopic,
          custom_topic_mode: customTopicMode,
          custom_intent: customIntent,
          custom_intent_mode: customIntentMode,
          callback,
          callback_method: callbackMethod,
        };

        const params = buildParams(paramMap);

        const url = `${DEEPGRAM_BASEURL}/read${params ? `?${params}` : ''}`;
        abortCtrl.current?.abort();
        abortCtrl.current = new AbortController();

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Token ${apiKey}`,
          },
          body: JSON.stringify({
            ...(text ? { text } : {}),
            ...(sourceUrl ? { url: sourceUrl } : {}),
          }),
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
      summarize,
      topics,
      customTopic,
      customTopicMode,
      intents,
      customIntent,
      customIntentMode,
      sentiment,
      language,
      callback,
      callbackMethod,
    ]
  );

  useEffect(() => {
    return () => {
      abortCtrl.current?.abort();
    };
  }, []);

  return { analyze };
}
