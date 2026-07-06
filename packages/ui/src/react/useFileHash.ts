import { useCallback, useState } from 'react';
import { sha256Hex } from '@polis/domain';

export type FileHashState = {
  fileName: string | null;
  hash: string | null;
  hashing: boolean;
  error: string | null;
};

/** Hashes a File entirely in the browser via Web Crypto. Bytes never leave the device. */
export function useFileHash() {
  const [state, setState] = useState<FileHashState>({
    fileName: null,
    hash: null,
    hashing: false,
    error: null,
  });

  const hashFile = useCallback(async (file: File): Promise<string | null> => {
    setState({ fileName: file.name, hash: null, hashing: true, error: null });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = await sha256Hex(bytes);
      setState({ fileName: file.name, hash, hashing: false, error: null });
      return hash;
    } catch (err) {
      setState({
        fileName: file.name,
        hash: null,
        hashing: false,
        error: err instanceof Error ? err.message : 'hashing failed',
      });
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setState({ fileName: null, hash: null, hashing: false, error: null });
  }, []);

  return { ...state, hashFile, reset };
}
