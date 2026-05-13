import { describe, expect, it } from 'vitest';
import { readArtifactTemplate, UnknownTemplateError } from '@/lib/templates';

describe('readArtifactTemplate', () => {
  it('returns the canonical template when no name is provided', async () => {
    const result = await readArtifactTemplate();
    expect(result.name).toBe('stamped-review-queue');
    expect(result.html.startsWith('<!doctype html>')).toBe(true);
    expect(result.html).toContain('cowork-artifact-meta');
    expect(typeof result.updatedAt).toBe('string');
    expect(new Date(result.updatedAt).toString()).not.toBe('Invalid Date');
  });

  it('returns the canonical template when name is explicitly the default', async () => {
    const result = await readArtifactTemplate('stamped-review-queue');
    expect(result.name).toBe('stamped-review-queue');
    expect(result.html.length).toBeGreaterThan(1000);
  });

  it('throws UnknownTemplateError on an unknown name (no arbitrary file reads)', async () => {
    await expect(readArtifactTemplate('totally-fake')).rejects.toBeInstanceOf(
      UnknownTemplateError,
    );
    await expect(readArtifactTemplate('../package')).rejects.toBeInstanceOf(
      UnknownTemplateError,
    );
  });
});
