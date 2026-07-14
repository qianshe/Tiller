export type PersistSessionAttachmentInput = {
  sessionId: string;
  messageId?: string;
  mimeType: string;
  name?: string;
  dataBase64: string;
};

export type StoredSessionAttachment = {
  id: string;
  sessionId: string;
  messageId?: string;
  mimeType: string;
  name?: string;
  sha256: string;
  byteSize: number;
  storageKey: string;
  uri: string;
  createdAt: string;
};

export type SessionAttachmentStore = {
  put: (input: PersistSessionAttachmentInput) => StoredSessionAttachment;
  get: (id: string) => StoredSessionAttachment | undefined;
  listForMessage: (sessionId: string, messageId: string) => StoredSessionAttachment[];
  readBytes: (id: string) => Buffer | undefined;
  remove: (id: string) => void;
  removeSession: (sessionId: string) => void;
};
