/**
 * Browser-safe YAML parsing. No Node.js imports — uses the `yaml` package directly.
 *
 * Mirrors the shape of viewer/v2/backend's existing `parseYAML` so the backend can
 * re-export from here without changing call sites.
 */

import { parse } from 'yaml';

export interface ParseResult {
  data: unknown;
  error?: {
    message: string;
    line?: number;
    column?: number;
  };
}

/**
 * Parse YAML content. Returns `{ data }` on success or `{ data: null, error }` on failure.
 * Strips a leading BOM if present.
 */
export function parseYAML(content: string): ParseResult {
  try {
    const stripped = stripBom(content);
    const data = parse(stripped, { strict: true, prettyErrors: true });
    return { data: data ?? {} };
  } catch (error: unknown) {
    let message = 'Invalid YAML syntax';
    let line: number | undefined;
    let column: number | undefined;
    if (error instanceof Error) {
      message = error.message;
      const lineMatch = error.message.match(/line (\d+)/i);
      const colMatch = error.message.match(/column (\d+)/i);
      if (lineMatch) line = parseInt(lineMatch[1], 10);
      if (colMatch) column = parseInt(colMatch[1], 10);
    }
    return {
      data: null,
      error: { message, line, column },
    };
  }
}

/** Strip the UTF-8 BOM (﻿) if present at the start of `content`. */
export function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}
