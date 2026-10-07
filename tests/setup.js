import { webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;
