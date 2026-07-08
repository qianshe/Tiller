export type PersistSessionOutputBodyInput = {
  sessionId: string;
  outputId: string;
  text: string;
};

export type StoredSessionOutputBody = {
  id: string;
  sessionId: string;
  outputId: string;
  mimeType: "text/plain; charset=utf-8";
  sha256: string;
  byteSize: number;
  storageKey: string;
  uri: string;
  createdAt: string;
};

export type SessionOutputBodyStore = {
  putText: (input: PersistSessionOutputBodyInput) => StoredSessionOutputBody;
  get: (sessionId: string, outputId: string) => StoredSessionOutputBody | undefined;
  readText: (sessionId: string, outputId: string) => string | undefined;
  removeSession: (sessionId: string) => void;
};
