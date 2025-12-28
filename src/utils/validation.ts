/**
 * Validation utilities for request data
 */

import { ProcessingContext, type ValidationResult } from "../types";

/**
 * Maximum file size: 25MB
 */
export const MAX_FILE_SIZE = 25 * 1024 * 1024;

/**
 * Supported audio MIME types
 */
export const SUPPORTED_MIME_TYPES = [
  "audio/mpeg", // MP3
  "audio/mp4", // M4A
  "audio/x-m4a", // M4A
  "audio/wav", // WAV
  "audio/wave", // WAV
  "audio/x-wav", // WAV
  "audio/flac", // FLAC
  "audio/ogg", // OGG
  "audio/webm", // WebM
  "application/octet-stream", // Generic binary
];

/**
 * Validates audio file
 */
export function validateAudioFile(
  buffer: ArrayBuffer,
  contentType: string
): ValidationResult {
  const errors: string[] = [];

  // Check file size
  if (buffer.byteLength === 0) {
    errors.push("Audio file is empty");
  }

  if (buffer.byteLength > MAX_FILE_SIZE) {
    errors.push(
      `File size (${Math.round(buffer.byteLength / 1024 / 1024)}MB) exceeds maximum allowed size of 25MB`
    );
  }

  // Check MIME type
  if (contentType && !SUPPORTED_MIME_TYPES.includes(contentType)) {
    errors.push(`Unsupported MIME type: ${contentType}`);
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Validates processing context
 */
export function validateContext(context: string): ValidationResult {
  const validContexts = Object.values(ProcessingContext);

  if (!validContexts.includes(context as ProcessingContext)) {
    return {
      valid: false,
      errors: [
        `Invalid context. Must be one of: ${validContexts.join(", ")}`,
      ],
    };
  }

  return { valid: true };
}

/**
 * Validates metadata structure
 */
export function validateMetadata(
  metadata: unknown
): ValidationResult {
  const errors: string[] = [];

  if (metadata !== undefined && metadata !== null) {
    if (typeof metadata !== "object" || Array.isArray(metadata)) {
      errors.push("Metadata must be an object");
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Sanitizes filename for storage
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .substring(0, 255);
}

/**
 * Validates UUID format
 */
export function isValidUUID(id: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

