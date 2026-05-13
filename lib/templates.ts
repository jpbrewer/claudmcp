import { promises as fs } from 'node:fs';
import path from 'node:path';

const ALLOWED_TEMPLATES = ['stamped-review-queue'] as const;
type TemplateName = (typeof ALLOWED_TEMPLATES)[number];

const DEFAULT_TEMPLATE: TemplateName = 'stamped-review-queue';

export class UnknownTemplateError extends Error {
  constructor(requested: string) {
    super(
      `Unknown artifact template: "${requested}". Available templates: ${ALLOWED_TEMPLATES.join(', ')}.`,
    );
    this.name = 'UnknownTemplateError';
  }
}

export async function readArtifactTemplate(
  name?: string,
): Promise<{ name: TemplateName; html: string; updatedAt: string }> {
  const resolved = name ?? DEFAULT_TEMPLATE;
  if (!(ALLOWED_TEMPLATES as readonly string[]).includes(resolved)) {
    throw new UnknownTemplateError(resolved);
  }
  const filePath = path.join(process.cwd(), 'artifacts', `${resolved}.html`);
  const [html, stat] = await Promise.all([
    fs.readFile(filePath, 'utf8'),
    fs.stat(filePath),
  ]);
  return { name: resolved as TemplateName, html, updatedAt: stat.mtime.toISOString() };
}
