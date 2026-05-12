import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function readBrandValues(): Promise<{ markdown: string; updatedAt: string }> {
  const filePath = path.join(process.cwd(), 'content', 'values.md');
  const [markdown, stat] = await Promise.all([
    fs.readFile(filePath, 'utf8'),
    fs.stat(filePath),
  ]);
  return { markdown, updatedAt: stat.mtime.toISOString() };
}
