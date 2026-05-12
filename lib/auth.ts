import { timingSafeEqual } from 'node:crypto';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

function getExpectedToken(): string {
  const expected = process.env.COWORK_MCP_TOKEN;
  if (!expected) {
    throw new Error('COWORK_MCP_TOKEN is not set');
  }
  return expected;
}

export function verifyBearer(token: string | undefined): AuthInfo | undefined {
  if (!token) return undefined;
  const expected = getExpectedToken();
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return undefined;
  if (!timingSafeEqual(a, b)) return undefined;
  return { token, clientId: 'cowork', scopes: [] };
}
