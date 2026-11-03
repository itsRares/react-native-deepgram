import { useRef } from 'react';

/** Ref that always holds the latest render's value (for stable callbacks). */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
