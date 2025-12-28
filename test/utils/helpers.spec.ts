import { describe, it, expect, vi } from "vitest";
import {
  generateId,
  getCurrentTimestamp,
  createErrorResponse,
  jsonResponse,
  safeJSONParse,
  truncate,
  getMimeTypeFromExtension,
} from "../../src/utils/helpers";

describe("Helper Utils", () => {
  describe("generateId", () => {
    it("should generate valid UUID", () => {
      const id = generateId();
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      expect(id).toMatch(uuidRegex);
    });

    it("should generate unique IDs", () => {
      const id1 = generateId();
      const id2 = generateId();

      expect(id1).not.toBe(id2);
    });
  });

  describe("getCurrentTimestamp", () => {
    it("should return ISO string", () => {
      const timestamp = getCurrentTimestamp();
      const date = new Date(timestamp);

      expect(date.toISOString()).toBe(timestamp);
    });

    it("should be recent timestamp", () => {
      const timestamp = getCurrentTimestamp();
      const date = new Date(timestamp);
      const now = new Date();

      expect(now.getTime() - date.getTime()).toBeLessThan(1000);
    });
  });

  describe("createErrorResponse", () => {
    it("should create error response with required fields", () => {
      const error = createErrorResponse("TEST_ERROR", "Test error message");

      expect(error.success).toBe(false);
      expect(error.error.code).toBe("TEST_ERROR");
      expect(error.error.message).toBe("Test error message");
      expect(error.timestamp).toBeDefined();
    });

    it("should include details when provided", () => {
      const details = { field: "value" };
      const error = createErrorResponse("TEST_ERROR", "Test message", details);

      expect(error.error.details).toEqual(details);
    });
  });

  describe("jsonResponse", () => {
    it("should create JSON response with default status", () => {
      const data = { test: "data" };
      const response = jsonResponse(data);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/json");
    });

    it("should create JSON response with custom status", () => {
      const data = { test: "data" };
      const response = jsonResponse(data, 201);

      expect(response.status).toBe(201);
    });

    it("should include custom headers", () => {
      const data = { test: "data" };
      const response = jsonResponse(data, 200, { "X-Custom": "header" });

      expect(response.headers.get("X-Custom")).toBe("header");
      expect(response.headers.get("Content-Type")).toBe("application/json");
    });

    it("should serialize data correctly", async () => {
      const data = { test: "data", number: 123 };
      const response = jsonResponse(data);
      const parsed = await response.json();

      expect(parsed).toEqual(data);
    });
  });

  describe("safeJSONParse", () => {
    it("should parse valid JSON", () => {
      const json = '{"test": "data"}';
      const result = safeJSONParse(json);

      expect(result).toEqual({ test: "data" });
    });

    it("should return null for invalid JSON", () => {
      const json = "{invalid json}";
      const result = safeJSONParse(json);

      expect(result).toBeNull();
    });

    it("should parse arrays", () => {
      const json = '[1, 2, 3]';
      const result = safeJSONParse(json);

      expect(result).toEqual([1, 2, 3]);
    });

    it("should parse null", () => {
      const json = 'null';
      const result = safeJSONParse(json);

      expect(result).toBeNull();
    });
  });

  describe("truncate", () => {
    it("should not truncate short text", () => {
      const text = "Short text";
      const result = truncate(text, 20);

      expect(result).toBe(text);
    });

    it("should truncate long text", () => {
      const text = "This is a very long text that should be truncated";
      const result = truncate(text, 20);

      expect(result).toBe("This is a very lo...");
      expect(result.length).toBe(20);
    });

    it("should handle exact length", () => {
      const text = "Exactly twenty chars";
      const result = truncate(text, 20);

      expect(result).toBe(text);
      expect(result.length).toBe(20);
    });
  });

  describe("getMimeTypeFromExtension", () => {
    it("should return correct MIME types", () => {
      expect(getMimeTypeFromExtension("file.mp3")).toBe("audio/mpeg");
      expect(getMimeTypeFromExtension("file.m4a")).toBe("audio/mp4");
      expect(getMimeTypeFromExtension("file.wav")).toBe("audio/wav");
      expect(getMimeTypeFromExtension("file.flac")).toBe("audio/flac");
      expect(getMimeTypeFromExtension("file.ogg")).toBe("audio/ogg");
    });

    it("should handle uppercase extensions", () => {
      expect(getMimeTypeFromExtension("file.MP3")).toBe("audio/mpeg");
      expect(getMimeTypeFromExtension("file.WAV")).toBe("audio/wav");
    });

    it("should return default for unknown extensions", () => {
      expect(getMimeTypeFromExtension("file.xyz")).toBe(
        "application/octet-stream"
      );
    });

    it("should handle files without extension", () => {
      expect(getMimeTypeFromExtension("file")).toBe("application/octet-stream");
    });
  });
});

