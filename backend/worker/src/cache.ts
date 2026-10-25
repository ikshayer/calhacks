import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { config } from './config.ts';

/**
 * Content-addressed result cache on the worker's disk (cache/<kind>/<key>.json).
 *
 * Keys hash everything that determines the result, always including the model
 * id and the full prompt text, so changing a prompt or a model is a miss on
 * its own. A cached value goes through the same validator as a live one; a
 * file that fails it is logged and recomputed, never trusted.
 */

const CACHE_DIR = new URL('../cache/', import.meta.url);

export function cacheKey(parts: unknown): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function fileFor(kind: string, key: string): URL {
  return new URL(`${kind}/${key}.json`, CACHE_DIR);
}

/** The cached value for these key parts, or undefined on a miss (or when CACHE_DISABLED is set). */
export async function lookup<T>(kind: string, keyParts: unknown, validate: (value: unknown) => T): Promise<T | undefined> {
  if (config.cacheDisabled) return undefined;
  const file = fileFor(kind, cacheKey(keyParts));
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    return validate(JSON.parse(raw));
  } catch (error) {
    console.warn(`[cache] ignoring invalid ${kind} entry ${file.pathname}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

export async function store(kind: string, keyParts: unknown, value: unknown): Promise<void> {
  if (config.cacheDisabled) return;
  await mkdir(new URL(`${kind}/`, CACHE_DIR), { recursive: true });
  await writeFile(fileFor(kind, cacheKey(keyParts)), JSON.stringify(value));
}

/** SHA-256 of a file's bytes, streamed, so a large upload is not read into memory. */
export function fileHash(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** Validator for cached plain-text results (explanations, comparison summaries). */
export function nonEmptyText(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error('expected a non-empty string');
  return value;
}
