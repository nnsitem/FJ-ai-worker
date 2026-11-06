'use client';

import { useEffect, useState } from 'react';
import { call, type Library } from './bridge';

let cached: Promise<Library> | null = null;

/** The imported agents and skills (read once per page load; `reload` after an import). */
export function useLibrary(): { library: Library | null; reload: () => void } {
  const [library, setLibrary] = useState<Library | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (n > 0) cached = null;
    cached ??= call('libraryList');
    let live = true;
    cached.then((l) => live && setLibrary(l)).catch(() => live && setLibrary({ agents: [], skills: [], aiOfficeLibrary: null }));
    return () => {
      live = false;
    };
  }, [n]);
  return { library, reload: () => setN((x) => x + 1) };
}
