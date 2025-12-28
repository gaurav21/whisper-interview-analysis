import { describe, it, expect, vi, beforeEach } from "vitest";
import { StorageService } from "../../src/services/storage";
import { TranscriptionStatus, AnalysisStatus, ProcessingContext } from "../../src/types";
import { createLogger } from "../../src/utils/logger";

describe("StorageService", () => {
  let mockEnv: any;
  let mockLogger: any;
  let storageService: StorageService;

  beforeEach(() => {
    // Mock R2 bucket
    const mockR2 = {
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue({
        text: vi.fn().mockResolvedValue("transcript text"),
      }),
    };

    // Mock D1 database
    const mockDB = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true }),
      first: vi.fn().mockResolvedValue(null),
    };

    mockEnv = {
      AUDIO_BUCKET: mockR2,
      DB: mockDB,
    };

    mockLogger = createLogger({ test: true });
    storageService = new StorageService(mockEnv, mockLogger);
  });

  describe("saveAudioFile", () => {
    it("should save audio file to R2 and metadata to D1", async () => {
      const audioId = "test-audio-id";
      const buffer = new ArrayBuffer(1024);
      const metadata = {
        id: audioId,
        originalFilename: "test.mp3",
        mimeType: "audio/mpeg",
        sizeBytes: 1024,
        uploadedAt: "2025-12-26T00:00:00.000Z",
      };

      await storageService.saveAudioFile(audioId, buffer, metadata);

      expect(mockEnv.AUDIO_BUCKET.put).toHaveBeenCalledWith(
        `audio/${audioId}`,
        buffer,
        expect.any(Object)
      );

      expect(mockEnv.DB.prepare).toHaveBeenCalled();
      expect(mockEnv.DB.bind).toHaveBeenCalledWith(
        audioId,
        metadata.originalFilename,
        metadata.mimeType,
        metadata.sizeBytes,
        null,
        `audio/${audioId}`
      );
    });
  });

  describe("saveTranscript", () => {
    it("should save transcript to R2 and return URL", async () => {
      const transcriptionId = "test-transcription-id";
      const text = "This is a test transcript";

      const url = await storageService.saveTranscript(transcriptionId, text);

      expect(mockEnv.AUDIO_BUCKET.put).toHaveBeenCalledWith(
        `transcripts/${transcriptionId}.txt`,
        text,
        expect.any(Object)
      );

      expect(url).toBe(`r2://transcripts/${transcriptionId}.txt`);
    });
  });

  describe("getTranscript", () => {
    it("should retrieve transcript from R2", async () => {
      const transcriptionId = "test-transcription-id";

      const transcript = await storageService.getTranscript(transcriptionId);

      expect(mockEnv.AUDIO_BUCKET.get).toHaveBeenCalledWith(
        `transcripts/${transcriptionId}.txt`
      );
      expect(transcript).toBe("transcript text");
    });

    it("should return null if transcript not found", async () => {
      mockEnv.AUDIO_BUCKET.get.mockResolvedValue(null);

      const transcript = await storageService.getTranscript("nonexistent");

      expect(transcript).toBeNull();
    });
  });

  describe("createTranscriptionRecord", () => {
    it("should create transcription record in D1", async () => {
      const record = {
        id: "test-id",
        audioId: "audio-id",
        context: ProcessingContext.CANDIDATE_INTERVIEW,
        status: TranscriptionStatus.PENDING,
      };

      await storageService.createTranscriptionRecord(record);

      expect(mockEnv.DB.prepare).toHaveBeenCalled();
      expect(mockEnv.DB.bind).toHaveBeenCalledWith(
        record.id,
        record.audioId,
        record.context,
        record.status,
        null,
        null,
        null,
        null,
        null
      );
      expect(mockEnv.DB.run).toHaveBeenCalled();
    });
  });

  describe("updateTranscriptionRecord", () => {
    it("should update transcription record", async () => {
      const id = "test-id";
      const updates = {
        status: TranscriptionStatus.COMPLETED,
        transcriptText: "Updated text",
      };

      await storageService.updateTranscriptionRecord(id, updates);

      expect(mockEnv.DB.prepare).toHaveBeenCalled();
      expect(mockEnv.DB.bind).toHaveBeenCalled();
      expect(mockEnv.DB.run).toHaveBeenCalled();
    });

    it("should handle empty updates gracefully", async () => {
      const id = "test-id";
      const updates = {};

      await storageService.updateTranscriptionRecord(id, updates);

      // Should not call DB methods for empty updates
      expect(mockEnv.DB.run).not.toHaveBeenCalled();
    });
  });

  describe("getTranscriptionRecord", () => {
    it("should retrieve transcription record from D1", async () => {
      const mockRecord = {
        id: "test-id",
        audio_id: "audio-id",
        context: ProcessingContext.CANDIDATE_INTERVIEW,
        status: TranscriptionStatus.COMPLETED,
        transcript_text: "Test transcript",
        transcript_url: "r2://test",
        error_message: null,
        metadata: null,
        created_at: "2025-12-26T00:00:00.000Z",
        updated_at: "2025-12-26T00:00:00.000Z",
        completed_at: "2025-12-26T00:00:00.000Z",
      };

      mockEnv.DB.first.mockResolvedValue(mockRecord);

      const record = await storageService.getTranscriptionRecord("test-id");

      expect(record).toBeDefined();
      expect(record?.id).toBe("test-id");
      expect(record?.audioId).toBe("audio-id");
      expect(record?.context).toBe(ProcessingContext.CANDIDATE_INTERVIEW);
    });

    it("should return null if record not found", async () => {
      mockEnv.DB.first.mockResolvedValue(null);

      const record = await storageService.getTranscriptionRecord("nonexistent");

      expect(record).toBeNull();
    });
  });

  describe("createAnalysisRecord", () => {
    it("should create analysis record in D1", async () => {
      const record = {
        id: "analysis-id",
        transcriptionId: "transcription-id",
        status: AnalysisStatus.PENDING,
        llmModel: "gpt-4o-mini",
      };

      await storageService.createAnalysisRecord(record);

      expect(mockEnv.DB.prepare).toHaveBeenCalled();
      expect(mockEnv.DB.bind).toHaveBeenCalled();
      expect(mockEnv.DB.run).toHaveBeenCalled();
    });
  });

  describe("updateAnalysisRecord", () => {
    it("should update analysis record", async () => {
      const id = "analysis-id";
      const updates = {
        status: AnalysisStatus.COMPLETED,
        summary: "Test summary",
        pros: ["pro1", "pro2"],
        cons: ["con1"],
      };

      await storageService.updateAnalysisRecord(id, updates);

      expect(mockEnv.DB.prepare).toHaveBeenCalled();
      expect(mockEnv.DB.bind).toHaveBeenCalled();
      expect(mockEnv.DB.run).toHaveBeenCalled();
    });
  });

  describe("getAnalysisRecord", () => {
    it("should retrieve analysis record from D1", async () => {
      const mockRecord = {
        id: "analysis-id",
        transcription_id: "transcription-id",
        status: AnalysisStatus.COMPLETED,
        summary: "Test summary",
        key_takeaways: '["takeaway1"]',
        pros: '["pro1"]',
        cons: '["con1"]',
        recommendations: '["rec1"]',
        sentiment: "positive",
        confidence_score: 0.9,
        llm_model: "gpt-4o-mini",
        error_message: null,
        metadata: null,
        created_at: "2025-12-26T00:00:00.000Z",
        updated_at: "2025-12-26T00:00:00.000Z",
        completed_at: "2025-12-26T00:00:00.000Z",
      };

      mockEnv.DB.first.mockResolvedValue(mockRecord);

      const record = await storageService.getAnalysisRecord("transcription-id");

      expect(record).toBeDefined();
      expect(record?.id).toBe("analysis-id");
      expect(record?.summary).toBe("Test summary");
      expect(record?.keyTakeaways).toEqual(["takeaway1"]);
    });

    it("should return null if analysis not found", async () => {
      mockEnv.DB.first.mockResolvedValue(null);

      const record = await storageService.getAnalysisRecord("nonexistent");

      expect(record).toBeNull();
    });
  });
});

