import { useRef, useCallback, useEffect } from 'react';
import type {
  UseDeepgramTextIntelligenceProps,
  UseDeepgramTextIntelligenceReturn,
} from './types';
import { DEEPGRAM_BASEURL } from './constants';

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
        const apiKey = (global as any).__DEEPGRAM_API_KEY__;
        if (!apiKey) throw new Error('Deepgram API key missing');

        const params = new URLSearchParams();
        if (options.summarize) params.append('summarize', 'true');
        if (options.topics) params.append('topics', 'true');
        if (options.intents) params.append('intents', 'true');
        if (options.sentiment) params.append('sentiment', 'true');
        if (options.language) params.append('language', options.language);
        if (options.customTopic) {
          if (Array.isArray(options.customTopic)) {
            options.customTopic.forEach((t) =>
              params.append('custom_topic', t)
            );
          } else {
            params.append('custom_topic', options.customTopic);
          }
        }
        if (options.customTopicMode) {
          params.append('custom_topic_mode', options.customTopicMode);
        }
        if (options.callback) params.append('callback', options.callback);
        if (options.callbackMethod) {
          params.append('callback_method', options.callbackMethod);
        }

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
