export type PersistSessionDiffBodyInput = {
  sessionId: string;
  path: string;
  text: string;
};

export type StoredSessionDiffBody = {
  id: string;
  sessionId: string;
  path: string;
  mimeType: "text/plain; charset=utf-8";
  sha256: string;
  byteSize: number;
  storageKey: string;
  uri: string;
  createdAt: string;
};

export type SessionDiffBodyStore = {
  putText: (input: PersistSessionDiffBodyInput) => StoredSessionDiffBody;
  get: (sessionId: string, path: string) => StoredSessionDiffBody | undefined;
  readText: (sessionId: string, path: string) => string | undefined;
  removeSession: (sessionId: string) => void;
};
