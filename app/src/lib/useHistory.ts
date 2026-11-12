import { useCallback, useRef, useState } from 'react';

/** Состояние с undo/redo. commit=false — промежуточные шаги (перетаскивание) */
export function useHistory<T>(initial: T) {
  const [state, setState] = useState(initial);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const base = useRef<T | null>(null);

  const set = useCallback((next: T | ((s: T) => T), commit = true) => {
    setState((cur) => {
      const value = typeof next === 'function' ? (next as (s: T) => T)(cur) : next;
      if (!commit) {
        if (base.current === null) base.current = cur;
        return value;
      }
      past.current.push(base.current ?? cur);
      if (past.current.length > 100) past.current.shift();
      base.current = null;
      future.current = [];
      return value;
    });
  }, []);

  const undo = useCallback(() => {
    setState((cur) => {
      const prev = past.current.pop();
      if (prev === undefined) return cur;
      future.current.push(cur);
      return prev;
    });
  }, []);

  const redo = useCallback(() => {
    setState((cur) => {
      const nxt = future.current.pop();
      if (nxt === undefined) return cur;
      past.current.push(cur);
      return nxt;
    });
  }, []);

  return { state, set, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}
