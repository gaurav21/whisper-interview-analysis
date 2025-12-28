/**
 * Helper utility functions
 */

import type { ErrorResponse } from "../types";

/**
 * Generates a UUID v4
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Formats current timestamp as ISO string
 */
export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Creates a standardized error response
 */
export function createErrorResponse(
  code: string,
  message: string,
  details?: Record<string, unknown>
): ErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      details,
    },
    timestamp: getCurrentTimestamp(),
  };
}

/**
 * Creates a JSON response with proper headers
 */
export function jsonResponse<T>(
  data: T,
  status: number = 200,
  headers?: Record<string, string>
): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

/**
 * Safely parses JSON, returns null on error
 */
export function safeJSONParse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/**
 * Delays execution for specified milliseconds
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries - 1) {
        const delayMs = baseDelay * Math.pow(2, attempt);
        console.warn(
          `Attempt ${attempt + 1} failed, retrying in ${delayMs}ms...`,
          lastError.message
        );
        await delay(delayMs);
      }
    }
  }

  throw lastError || new Error("Max retries exceeded");
}

/**
 * Truncates text to specified length
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + "...";
}

/**
 * Detects if audio format can be safely chunked
 */
export function canChunkAudioFormat(
  contentType: string,
  audioData: ArrayBuffer
): boolean {
  // Check content type
  if (
    contentType.includes("mp3") ||
    contentType.includes("m4a") ||
    contentType.includes("aac") ||
    contentType.includes("ogg") ||
    contentType.includes("mpeg") ||
    contentType.includes("mp4")
  ) {
    return false;
  }

  // Check magic numbers (file signatures)
  const view = new Uint8Array(audioData.slice(0, 12));

  // M4A/MP4 (starts with ftyp)
  if (
    view.length >= 8 &&
    view[4] === 0x66 &&
    view[5] === 0x74 &&
    view[6] === 0x79 &&
    view[7] === 0x70
  ) {
    return false;
  }

  // MP3 (starts with ID3 or 0xFF)
  if (view[0] === 0x49 && view[1] === 0x44 && view[2] === 0x33) {
    return false;
  }
  if (view[0] === 0xff && (view[1] & 0xe0) === 0xe0) {
    return false;
  }

  // WAV (starts with RIFF...WAVE)
  if (
    view.length >= 12 &&
    view[0] === 0x52 &&
    view[1] === 0x49 &&
    view[2] === 0x46 &&
    view[3] === 0x46
  ) {
    return true; // WAV can be chunked
  }

  // Default: don't chunk if unsure
  return false;
}

/**
 * Gets MIME type from file extension
 */
export function getMimeTypeFromExtension(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();

  const mimeTypes: Record<string, string> = {
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    wav: "audio/wav",
    flac: "audio/flac",
    ogg: "audio/ogg",
    webm: "audio/webm",
  };

  return mimeTypes[ext || ""] || "application/octet-stream";
}

