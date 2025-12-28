/**
 * Storage service for R2 and D1 operations
 */

import type {
  Env,
  AudioMetadata,
  TranscriptionRecord,
  AnalysisRecord,
  IStorageService,
} from "../types";
import { Logger } from "../utils/logger";
import { safeJSONParse } from "../utils/helpers";

export class StorageService implements IStorageService {
  private env: Env;
  private logger: Logger;

  constructor(env: Env, logger: Logger) {
    this.env = env;
    this.logger = logger.child({ service: "StorageService" });
  }

  /**
   * Saves audio file to R2 bucket
   */
  async saveAudioFile(
    id: string,
    buffer: ArrayBuffer,
    metadata: AudioMetadata
  ): Promise<void> {
    try {
      const key = `audio/${id}`;
      this.logger.info("Saving audio file to R2", {
        audioId: id,
        key,
        sizeBytes: buffer.byteLength,
      });

      await this.env.AUDIO_BUCKET.put(key, buffer, {
        httpMetadata: {
          contentType: metadata.mimeType,
        },
        customMetadata: {
          originalFilename: metadata.originalFilename,
          uploadedAt: metadata.uploadedAt,
        },
      });

      // Also save metadata to D1
      await this.env.DB.prepare(`
        INSERT INTO audio_files (id, original_filename, mime_type, size_bytes, duration_seconds, r2_key)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
        .bind(
          id,
          metadata.originalFilename,
          metadata.mimeType,
          metadata.sizeBytes,
          metadata.durationSeconds || null,
          key
        )
        .run();

      this.logger.info("Audio file saved successfully", { audioId: id });
    } catch (error) {
      this.logger.error("Failed to save audio file", error, { audioId: id });
      throw new Error(`Failed to save audio file: ${error}`);
    }
  }

  /**
   * Saves transcript to R2 and returns URL
   */
  async saveTranscript(id: string, text: string): Promise<string> {
    try {
      const key = `transcripts/${id}.txt`;
      this.logger.info("Saving transcript to R2", {
        transcriptionId: id,
        key,
        textLength: text.length,
      });

      await this.env.AUDIO_BUCKET.put(key, text, {
        httpMetadata: {
          contentType: "text/plain; charset=utf-8",
        },
      });

      const url = `r2://${key}`;
      this.logger.info("Transcript saved successfully", {
        transcriptionId: id,
        url,
      });

      return url;
    } catch (error) {
      this.logger.error("Failed to save transcript", error, {
        transcriptionId: id,
      });
      throw new Error(`Failed to save transcript: ${error}`);
    }
  }

  /**
   * Retrieves transcript from R2
   */
  async getTranscript(id: string): Promise<string | null> {
    try {
      const key = `transcripts/${id}.txt`;
      const object = await this.env.AUDIO_BUCKET.get(key);

      if (!object) {
        this.logger.warn("Transcript not found", { transcriptionId: id, key });
        return null;
      }

      return await object.text();
    } catch (error) {
      this.logger.error("Failed to retrieve transcript", error, {
        transcriptionId: id,
      });
      return null;
    }
  }

  /**
   * Creates a transcription record in D1
   */
  async createTranscriptionRecord(
    record: Omit<TranscriptionRecord, "createdAt" | "updatedAt">
  ): Promise<void> {
    try {
      this.logger.info("Creating transcription record", {
        transcriptionId: record.id,
      });

      await this.env.DB.prepare(`
        INSERT INTO transcriptions (
          id, audio_id, context, status, transcript_text, transcript_url,
          error_message, metadata, completed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .bind(
          record.id,
          record.audioId,
          record.context,
          record.status,
          record.transcriptText || null,
          record.transcriptUrl || null,
          record.errorMessage || null,
          record.metadata ? JSON.stringify(record.metadata) : null,
          record.completedAt || null
        )
        .run();

      this.logger.info("Transcription record created", {
        transcriptionId: record.id,
      });
    } catch (error) {
      this.logger.error("Failed to create transcription record", error, {
        transcriptionId: record.id,
      });
      throw new Error(`Failed to create transcription record: ${error}`);
    }
  }

  /**
   * Updates a transcription record in D1
   */
  async updateTranscriptionRecord(
    id: string,
    updates: Partial<TranscriptionRecord>
  ): Promise<void> {
    try {
      this.logger.info("Updating transcription record", {
        transcriptionId: id,
        updates: Object.keys(updates),
      });

      const setClauses: string[] = [];
      const bindings: unknown[] = [];

      if (updates.status !== undefined) {
        setClauses.push("status = ?");
        bindings.push(updates.status);
      }
      if (updates.transcriptText !== undefined) {
        setClauses.push("transcript_text = ?");
        bindings.push(updates.transcriptText);
      }
      if (updates.transcriptUrl !== undefined) {
        setClauses.push("transcript_url = ?");
        bindings.push(updates.transcriptUrl);
      }
      if (updates.errorMessage !== undefined) {
        setClauses.push("error_message = ?");
        bindings.push(updates.errorMessage);
      }
      if (updates.metadata !== undefined) {
        setClauses.push("metadata = ?");
        bindings.push(JSON.stringify(updates.metadata));
      }
      if (updates.completedAt !== undefined) {
        setClauses.push("completed_at = ?");
        bindings.push(updates.completedAt);
      }

      if (setClauses.length === 0) {
        this.logger.warn("No fields to update", { transcriptionId: id });
        return;
      }

      bindings.push(id);

      await this.env.DB.prepare(`
        UPDATE transcriptions
        SET ${setClauses.join(", ")}
        WHERE id = ?
      `)
        .bind(...bindings)
        .run();

      this.logger.info("Transcription record updated", {
        transcriptionId: id,
      });
    } catch (error) {
      this.logger.error("Failed to update transcription record", error, {
        transcriptionId: id,
      });
      throw new Error(`Failed to update transcription record: ${error}`);
    }
  }

  /**
   * Retrieves a transcription record from D1
   */
  async getTranscriptionRecord(
    id: string
  ): Promise<TranscriptionRecord | null> {
    try {
      const result = await this.env.DB.prepare(`
        SELECT * FROM transcriptions WHERE id = ?
      `)
        .bind(id)
        .first();

      if (!result) {
        this.logger.warn("Transcription record not found", {
          transcriptionId: id,
        });
        return null;
      }

      return this.mapToTranscriptionRecord(result);
    } catch (error) {
      this.logger.error("Failed to retrieve transcription record", error, {
        transcriptionId: id,
      });
      throw new Error(`Failed to retrieve transcription record: ${error}`);
    }
  }

  /**
   * Creates an analysis record in D1
   */
  async createAnalysisRecord(
    record: Omit<AnalysisRecord, "createdAt" | "updatedAt">
  ): Promise<void> {
    try {
      this.logger.info("Creating analysis record", {
        analysisId: record.id,
        transcriptionId: record.transcriptionId,
      });

      await this.env.DB.prepare(`
        INSERT INTO analyses (
          id, transcription_id, status, summary, key_takeaways, pros, cons,
          recommendations, sentiment, confidence_score, llm_model,
          error_message, metadata, completed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .bind(
          record.id,
          record.transcriptionId,
          record.status,
          record.summary || null,
          record.keyTakeaways ? JSON.stringify(record.keyTakeaways) : null,
          record.pros ? JSON.stringify(record.pros) : null,
          record.cons ? JSON.stringify(record.cons) : null,
          record.recommendations
            ? JSON.stringify(record.recommendations)
            : null,
          record.sentiment || null,
          record.confidenceScore || null,
          record.llmModel,
          record.errorMessage || null,
          record.metadata ? JSON.stringify(record.metadata) : null,
          record.completedAt || null
        )
        .run();

      this.logger.info("Analysis record created", { analysisId: record.id });
    } catch (error) {
      this.logger.error("Failed to create analysis record", error, {
        analysisId: record.id,
      });
      throw new Error(`Failed to create analysis record: ${error}`);
    }
  }

  /**
   * Updates an analysis record in D1
   */
  async updateAnalysisRecord(
    id: string,
    updates: Partial<AnalysisRecord>
  ): Promise<void> {
    try {
      this.logger.info("Updating analysis record", {
        analysisId: id,
        updates: Object.keys(updates),
      });

      const setClauses: string[] = [];
      const bindings: unknown[] = [];

      if (updates.status !== undefined) {
        setClauses.push("status = ?");
        bindings.push(updates.status);
      }
      if (updates.summary !== undefined) {
        setClauses.push("summary = ?");
        bindings.push(updates.summary);
      }
      if (updates.keyTakeaways !== undefined) {
        setClauses.push("key_takeaways = ?");
        bindings.push(JSON.stringify(updates.keyTakeaways));
      }
      if (updates.pros !== undefined) {
        setClauses.push("pros = ?");
        bindings.push(JSON.stringify(updates.pros));
      }
      if (updates.cons !== undefined) {
        setClauses.push("cons = ?");
        bindings.push(JSON.stringify(updates.cons));
      }
      if (updates.recommendations !== undefined) {
        setClauses.push("recommendations = ?");
        bindings.push(JSON.stringify(updates.recommendations));
      }
      if (updates.sentiment !== undefined) {
        setClauses.push("sentiment = ?");
        bindings.push(updates.sentiment);
      }
      if (updates.confidenceScore !== undefined) {
        setClauses.push("confidence_score = ?");
        bindings.push(updates.confidenceScore);
      }
      if (updates.errorMessage !== undefined) {
        setClauses.push("error_message = ?");
        bindings.push(updates.errorMessage);
      }
      if (updates.metadata !== undefined) {
        setClauses.push("metadata = ?");
        bindings.push(JSON.stringify(updates.metadata));
      }
      if (updates.completedAt !== undefined) {
        setClauses.push("completed_at = ?");
        bindings.push(updates.completedAt);
      }

      if (setClauses.length === 0) {
        this.logger.warn("No fields to update", { analysisId: id });
        return;
      }

      bindings.push(id);

      await this.env.DB.prepare(`
        UPDATE analyses
        SET ${setClauses.join(", ")}
        WHERE id = ?
      `)
        .bind(...bindings)
        .run();

      this.logger.info("Analysis record updated", { analysisId: id });
    } catch (error) {
      this.logger.error("Failed to update analysis record", error, {
        analysisId: id,
      });
      throw new Error(`Failed to update analysis record: ${error}`);
    }
  }

  /**
   * Retrieves an analysis record from D1 by transcription ID
   */
  async getAnalysisRecord(
    transcriptionId: string
  ): Promise<AnalysisRecord | null> {
    try {
      const result = await this.env.DB.prepare(`
        SELECT * FROM analyses WHERE transcription_id = ? ORDER BY created_at DESC LIMIT 1
      `)
        .bind(transcriptionId)
        .first();

      if (!result) {
        this.logger.debug("Analysis record not found", { transcriptionId });
        return null;
      }

      return this.mapToAnalysisRecord(result);
    } catch (error) {
      this.logger.error("Failed to retrieve analysis record", error, {
        transcriptionId,
      });
      throw new Error(`Failed to retrieve analysis record: ${error}`);
    }
  }

  /**
   * Maps D1 result to TranscriptionRecord
   */
  private mapToTranscriptionRecord(row: Record<string, unknown>): TranscriptionRecord {
    return {
      id: String(row.id),
      audioId: String(row.audio_id),
      context: String(row.context) as any,
      status: String(row.status) as any,
      transcriptText: row.transcript_text ? String(row.transcript_text) : undefined,
      transcriptUrl: row.transcript_url ? String(row.transcript_url) : undefined,
      errorMessage: row.error_message ? String(row.error_message) : undefined,
      metadata: row.metadata ? safeJSONParse(String(row.metadata)) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      completedAt: row.completed_at ? String(row.completed_at) : undefined,
    };
  }

  /**
   * Maps D1 result to AnalysisRecord
   */
  private mapToAnalysisRecord(row: Record<string, unknown>): AnalysisRecord {
    return {
      id: String(row.id),
      transcriptionId: String(row.transcription_id),
      status: String(row.status) as any,
      summary: row.summary ? String(row.summary) : undefined,
      keyTakeaways: row.key_takeaways
        ? safeJSONParse(String(row.key_takeaways))
        : undefined,
      pros: row.pros ? safeJSONParse(String(row.pros)) : undefined,
      cons: row.cons ? safeJSONParse(String(row.cons)) : undefined,
      recommendations: row.recommendations
        ? safeJSONParse(String(row.recommendations))
        : undefined,
      sentiment: row.sentiment ? String(row.sentiment) : undefined,
      confidenceScore: row.confidence_score
        ? Number(row.confidence_score)
        : undefined,
      llmModel: String(row.llm_model),
      errorMessage: row.error_message ? String(row.error_message) : undefined,
      metadata: row.metadata ? safeJSONParse(String(row.metadata)) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      completedAt: row.completed_at ? String(row.completed_at) : undefined,
    };
  }
}

