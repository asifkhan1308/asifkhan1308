import { useSyncExternalStore } from 'react';
import type { EditorSession } from './session';

/** Re-render whenever the document or index changes. */
export function useStoreVersion(session: EditorSession) {
  return useSyncExternalStore(session.store.subscribe, session.store.getSnapshot);
}
