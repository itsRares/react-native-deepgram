import { useRef, useCallback, useEffect, useState } from 'react';
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
  trackState = false,
}: UseDeepgramTextIntelligenceProps = {}): UseDeepgramTextIntelligenceReturn {
  const onBeforeAnalyzeRef = useRef(onBeforeAnalyze);
  const onAnalyzeSuccessRef = useRef(onAnalyzeSuccess);
  const onAnalyzeErrorRef = useRef(onAnalyzeError);

  useEffect(() => {
    onBeforeAnalyzeRef.current = onBeforeAnalyze;
    onAnalyzeSuccessRef.current = onAnalyzeSuccess;
    onAnalyzeErrorRef.current = onAnalyzeError;
  });

  const [internalState, setInternalState] = useState<{
    status: 'idle' | 'loading' | 'analyzing' | 'error';
    error: Error | null;
  }>({
    status: 'idle',
    error: null,
  });
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
      onBeforeAnalyzeRef.current();

      if (trackState) {
        setInternalState({ status: 'analyzing', error: null });
      }

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
        onAnalyzeSuccessRef.current(json);
        if (trackState) {
          setInternalState({ status: 'idle', error: null });
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        onAnalyzeErrorRef.current(err);
        if (trackState) {
          setInternalState({
            status: 'error',
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      }
    },
    [
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
      trackState,
    ]
  );

  useEffect(() => {
    return () => {
      abortCtrl.current?.abort();
    };
  }, []);

  return {
    analyze,
    ...(trackState ? { state: internalState } : {}),
  };
}
