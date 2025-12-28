import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAIService } from "../../src/services/openai";
import { createLogger } from "../../src/utils/logger";

describe("OpenAIService", () => {
  let mockEnv: any;
  let mockLogger: any;
  let openaiService: OpenAIService;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    mockEnv = {
      OPENAI_API_KEY: "test-api-key",
    };

    mockLogger = createLogger({ test: true });
    openaiService = new OpenAIService(mockEnv, mockLogger);

    // Save original fetch
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    // Restore original fetch
    globalThis.fetch = originalFetch;
  });

  describe("analyzeInterview", () => {
    it("should analyze interview transcript successfully", async () => {
      const mockResponse = {
        id: "test-id",
        object: "chat.completion",
        created: Date.now(),
        model: "gpt-4o-mini",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant" as const,
              content: JSON.stringify({
                summary: "Test summary",
                keyTakeaways: ["takeaway1", "takeaway2"],
                pros: ["pro1", "pro2"],
                cons: ["con1"],
                recommendations: ["rec1", "rec2"],
                sentiment: "positive",
                confidenceScore: 0.85,
              }),
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await openaiService.analyzeInterview(
        "Test transcript",
        { candidateName: "John Doe" }
      );

      expect(result.summary).toBe("Test summary");
      expect(result.keyTakeaways).toHaveLength(2);
      expect(result.pros).toHaveLength(2);
      expect(result.cons).toHaveLength(1);
      expect(result.sentiment).toBe("positive");
      expect(result.confidenceScore).toBe(0.85);
    });

    it("should handle API errors gracefully", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "Server error",
      } as Response);

      await expect(
        openaiService.analyzeInterview("Test transcript")
      ).rejects.toThrow();
    });

    it("should retry on failure", async () => {
      let callCount = 0;

      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 2) {
          return Promise.resolve({
            ok: false,
            status: 503,
            text: async () => "Service unavailable",
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: "Test",
                    keyTakeaways: [],
                    pros: [],
                    cons: [],
                    recommendations: [],
                    sentiment: "neutral",
                    confidenceScore: 0.5,
                  }),
                },
              },
            ],
            usage: { total_tokens: 100 },
          }),
        } as Response);
      });

      await openaiService.analyzeInterview("Test transcript");

      expect(callCount).toBeGreaterThan(1);
    });

    it("should parse malformed response with fallback", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "invalid json",
              },
            },
          ],
          usage: { total_tokens: 100 },
        }),
      } as Response);

      const result = await openaiService.analyzeInterview("Test transcript");

      // Should return fallback response
      expect(result.summary).toContain("Analysis parsing failed");
      expect(result.confidenceScore).toBe(0);
    });
  });

  describe("analyzeMeeting", () => {
    it("should analyze meeting transcript successfully", async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "Meeting summary",
                keyTakeaways: ["decision1", "decision2"],
                pros: ["progress1"],
                cons: ["blocker1"],
                recommendations: ["action1"],
                sentiment: "neutral",
                confidenceScore: 0.75,
              }),
            },
          },
        ],
        usage: { total_tokens: 100 },
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await openaiService.analyzeMeeting(
        "Meeting transcript",
        { date: "2025-12-26" }
      );

      expect(result.summary).toBe("Meeting summary");
      expect(result.keyTakeaways).toHaveLength(2);
      expect(result.sentiment).toBe("neutral");
    });
  });
});

