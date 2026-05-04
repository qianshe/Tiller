export type PairingState = {
  ensureCode(): string;
  getCode(): string | null;
  reset(): void;
};

export type CreatePairingStateOptions = {
  generate?: () => string;
};

const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRING_CODE_LENGTH = 6;

export function generatePairingCode(): string {
  let code = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    code += PAIRING_CODE_ALPHABET[Math.floor(Math.random() * PAIRING_CODE_ALPHABET.length)];
  }
  return code;
}

export function createPairingState(options: CreatePairingStateOptions = {}): PairingState {
  const generate = options.generate ?? generatePairingCode;
  let code: string | null = null;
  return {
    ensureCode() {
      if (!code) {
        code = generate();
      }
      return code;
    },
    getCode() {
      return code;
    },
    reset() {
      code = null;
    },
  };
}
