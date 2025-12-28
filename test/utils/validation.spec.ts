import { describe, it, expect } from "vitest";
import {
  validateAudioFile,
  validateContext,
  validateMetadata,
  sanitizeFilename,
  isValidUUID,
  MAX_FILE_SIZE,
} from "../../src/utils/validation";
import { ProcessingContext } from "../../src/types";

describe("Validation Utils", () => {
  describe("validateAudioFile", () => {
    it("should validate a correct audio file", () => {
      const buffer = new ArrayBuffer(1024 * 1024); // 1MB
      const result = validateAudioFile(buffer, "audio/mpeg");

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it("should reject empty audio file", () => {
      const buffer = new ArrayBuffer(0);
      const result = validateAudioFile(buffer, "audio/mpeg");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Audio file is empty");
    });

    it("should reject file exceeding max size", () => {
      const buffer = new ArrayBuffer(MAX_FILE_SIZE + 1);
      const result = validateAudioFile(buffer, "audio/mpeg");

      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain("exceeds maximum allowed size");
    });

    it("should reject unsupported MIME type", () => {
      const buffer = new ArrayBuffer(1024);
      const result = validateAudioFile(buffer, "video/mp4");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Unsupported MIME type: video/mp4");
    });

    it("should accept all supported MIME types", () => {
      const supportedTypes = [
        "audio/mpeg",
        "audio/mp4",
        "audio/wav",
        "audio/flac",
        "audio/ogg",
        "application/octet-stream",
      ];

      const buffer = new ArrayBuffer(1024);

      supportedTypes.forEach((mimeType) => {
        const result = validateAudioFile(buffer, mimeType);
        expect(result.valid).toBe(true);
      });
    });
  });

  describe("validateContext", () => {
    it("should validate correct contexts", () => {
      const contexts = Object.values(ProcessingContext);

      contexts.forEach((context) => {
        const result = validateContext(context);
        expect(result.valid).toBe(true);
      });
    });

    it("should reject invalid context", () => {
      const result = validateContext("invalid_context");

      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain("Invalid context");
    });
  });

  describe("validateMetadata", () => {
    it("should validate valid metadata object", () => {
      const metadata = { candidateName: "John Doe", position: "Engineer" };
      const result = validateMetadata(metadata);

      expect(result.valid).toBe(true);
    });

    it("should accept undefined metadata", () => {
      const result = validateMetadata(undefined);
      expect(result.valid).toBe(true);
    });

    it("should accept null metadata", () => {
      const result = validateMetadata(null);
      expect(result.valid).toBe(true);
    });

    it("should reject non-object metadata", () => {
      const result = validateMetadata("invalid");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Metadata must be an object");
    });

    it("should reject array metadata", () => {
      const result = validateMetadata([1, 2, 3]);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Metadata must be an object");
    });
  });

  describe("sanitizeFilename", () => {
    it("should sanitize special characters", () => {
      const result = sanitizeFilename("file name!@#$%.mp3");
      // Special characters are replaced with underscores, then collapsed
      expect(result).toBe("file_name_.mp3");
    });

    it("should collapse multiple underscores", () => {
      const result = sanitizeFilename("file___name.mp3");
      expect(result).toBe("file_name.mp3");
    });

    it("should truncate long filenames", () => {
      const longName = "a".repeat(300) + ".mp3";
      const result = sanitizeFilename(longName);
      expect(result.length).toBeLessThanOrEqual(255);
    });

    it("should preserve valid characters", () => {
      const result = sanitizeFilename("valid-file_name.123.mp3");
      expect(result).toBe("valid-file_name.123.mp3");
    });
  });

  describe("isValidUUID", () => {
    it("should validate correct UUIDs", () => {
      const validUUIDs = [
        "123e4567-e89b-12d3-a456-426614174000",
        "550e8400-e29b-41d4-a716-446655440000",
        "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      ];

      validUUIDs.forEach((uuid) => {
        expect(isValidUUID(uuid)).toBe(true);
      });
    });

    it("should reject invalid UUIDs", () => {
      const invalidUUIDs = [
        "not-a-uuid",
        "123e4567-e89b-12d3-a456",
        "123e4567e89b12d3a456426614174000",
        "",
        "123e4567-e89b-12d3-a456-42661417400g",
      ];

      invalidUUIDs.forEach((uuid) => {
        expect(isValidUUID(uuid)).toBe(false);
      });
    });
  });
});

