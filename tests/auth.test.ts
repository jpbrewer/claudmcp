import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyBearer } from '@/lib/auth';

const ENV_KEY = 'COWORK_MCP_TOKEN';

describe('verifyBearer', () => {
  const originalToken = process.env[ENV_KEY];

  beforeEach(() => {
    process.env[ENV_KEY] = 'supersecret-test-token';
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalToken;
  });

  it('returns AuthInfo when the token matches', () => {
    const info = verifyBearer('supersecret-test-token');
    expect(info).toEqual({
      token: 'supersecret-test-token',
      clientId: 'cowork',
      scopes: [],
    });
  });

  it('returns undefined when the token is wrong', () => {
    expect(verifyBearer('nope-wrong-token-here')).toBeUndefined();
  });

  it('returns undefined for an empty / missing token', () => {
    expect(verifyBearer(undefined)).toBeUndefined();
    expect(verifyBearer('')).toBeUndefined();
  });

  it('returns undefined when token length differs (constant-time guard)', () => {
    expect(verifyBearer('short')).toBeUndefined();
    expect(verifyBearer('supersecret-test-token-extra-bytes')).toBeUndefined();
  });

  it('throws when the expected token env var is unset', () => {
    delete process.env[ENV_KEY];
    expect(() => verifyBearer('anything')).toThrow(/COWORK_MCP_TOKEN/);
  });
});
