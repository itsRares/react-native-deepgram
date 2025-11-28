import { useState, useCallback } from 'react';

export interface UseAsyncCallReturn<T> {
  data: T | null;
  status: 'idle' | 'loading' | 'error';
  error: Error | null;
  execute: () => Promise<T>;
  reset: () => void;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
}

export function useAsyncCall<T>(
  asyncFn: () => Promise<T>
): UseAsyncCallReturn<T> {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const result = await asyncFn();
      setData(result);
      setStatus('idle');
      return result;
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }, [asyncFn]);

  const reset = useCallback(() => {
    setData(null);
    setStatus('idle');
    setError(null);
  }, []);

  return {
    data,
    status,
    error,
    execute,
    reset,
    isLoading: status === 'loading',
    isError: status === 'error',
    isSuccess: status === 'idle' && data !== null,
  };
}
