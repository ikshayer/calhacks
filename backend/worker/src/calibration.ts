import { readFileSync } from 'node:fs';
import type { Signal } from './jev.ts';

/**
 * Fixed per-signal multipliers that map JEV's raw probabilities onto real
 * Instagram rates. They are constants: never normalised per run or per video.
 */
export interface Calibration {
  version: number;
  createdAt: string;
  source: string;
  uncalibrated: boolean;
  multipliers: Record<Signal, number>;
  notes: string;
}

const SIGNALS: Signal[] = ['watch', 'like', 'comment', 'share'];

function invalid(origin: string, problem: string): never {
  throw new Error(`Invalid calibration file ${origin}: ${problem}`);
}

export function parseCalibration(raw: unknown, origin: string): Calibration {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return invalid(origin, 'expected a JSON object');
  const { version, createdAt, source, uncalibrated, multipliers: rawMultipliers, notes } = raw as Record<string, unknown>;

  if (typeof version !== 'number') return invalid(origin, '"version" must be a number');
  if (typeof createdAt !== 'string') return invalid(origin, '"createdAt" must be a string');
  if (typeof source !== 'string') return invalid(origin, '"source" must be a string');
  if (typeof uncalibrated !== 'boolean') return invalid(origin, '"uncalibrated" must be a boolean');
  if (typeof notes !== 'string') return invalid(origin, '"notes" must be a string');
  if (typeof rawMultipliers !== 'object' || rawMultipliers === null) return invalid(origin, '"multipliers" must be an object');

  const fields: Record<string, unknown> = { ...rawMultipliers };
  const multipliers: Record<Signal, number> = { watch: 0, like: 0, comment: 0, share: 0 };
  for (const signal of SIGNALS) {
    const value = fields[signal];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return invalid(origin, `"multipliers.${signal}" must be a finite number >= 0`);
    }
    multipliers[signal] = value;
  }
  return { version, createdAt, source, uncalibrated, multipliers, notes };
}

function loadCalibration(): Calibration {
  const url = new URL('../calibration.json', import.meta.url);
  let text: string;
  try {
    text = readFileSync(url, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read calibration file ${url.pathname}: ${error instanceof Error ? error.message : String(error)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Calibration file ${url.pathname} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseCalibration(json, url.pathname);
}

/** Loaded and validated once at worker startup, so a malformed file stops the worker immediately. */
export const calibration = loadCalibration();

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function calibrate(raw: Record<Signal, number>): Record<Signal, number> {
  const m = calibration.multipliers;
  return {
    watch: clamp01(raw.watch * m.watch),
    like: clamp01(raw.like * m.like),
    comment: clamp01(raw.comment * m.comment),
    share: clamp01(raw.share * m.share),
  };
}
