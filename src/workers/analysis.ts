/**
 * Analysis Worker - Processes transcripts using OpenAI
 * This worker is triggered by queue messages
 */

import type {
  Env,
  AnalysisMessage,
  ProcessingContext,
  AnalysisStatus,
} from "../types";
import { StorageService } from "../services/storage";
import { OpenAIService } from "../services/openai";
import { createLogger } from "../utils/logger";
import { generateId, getCurrentTimestamp } from "../utils/helpers";

export class AnalysisWorker {
  /**
   * Handles queue messages
   */
  async queue(
    batch: MessageBatch<AnalysisMessage>,
    env: Env
  ): Promise<void> {
    const logger = createLogger(
      { worker: "analysis" },
      env.ENVIRONMENT
    );

    logger.info("Processing analysis batch", {
      messageCount: batch.messages.length,
    });

    for (const message of batch.messages) {
      try {
        await this.processAnalysis(message.body, env, logger);
        message.ack();
      } catch (error) {
        logger.error("Failed to process analysis message", error, {
          messageId: message.id,
          transcriptionId: message.body.transcriptionId,
        });
        
        // Retry the message (it will be retried automatically by the queue)
        message.retry();
      }
    }

    logger.info("Batch processing completed", {
      messageCount: batch.messages.length,
    });
  }

  /**
   * Processes a single analysis job
   */
  private async processAnalysis(
    message: AnalysisMessage,
    env: Env,
    logger: typeof import("../utils/logger").Logger.prototype
  ): Promise<void> {
    const jobLogger = logger.child({
      transcriptionId: message.transcriptionId,
      context: message.context,
    });

    jobLogger.info("Starting analysis");

    const analysisId = generateId();
    const storageService = new StorageService(env, jobLogger);

    try {
      // Create initial analysis record
      await storageService.createAnalysisRecord({
        id: analysisId,
        transcriptionId: message.transcriptionId,
        status: AnalysisStatus.PROCESSING,
        llmModel: "gpt-4o-mini",
      });

      // Get transcript
      const transcriptionRecord = await storageService.getTranscriptionRecord(
        message.transcriptionId
      );

      if (!transcriptionRecord || !transcriptionRecord.transcriptText) {
        throw new Error("Transcript not found or empty");
      }

      jobLogger.info("Transcript retrieved", {
        transcriptLength: transcriptionRecord.transcriptText.length,
      });

      // Perform analysis using OpenAI
      const openaiService = new OpenAIService(env, jobLogger);
      let analysisResult;

      if (message.context === ProcessingContext.CANDIDATE_INTERVIEW) {
        analysisResult = await openaiService.analyzeInterview(
          transcriptionRecord.transcriptText,
          message.metadata
        );
      } else if (message.context === ProcessingContext.TEAM_MEETING) {
        analysisResult = await openaiService.analyzeMeeting(
          transcriptionRecord.transcriptText,
          message.metadata
        );
      } else {
        throw new Error(`Unsupported context for analysis: ${message.context}`);
      }

      jobLogger.info("Analysis completed", {
        sentiment: analysisResult.sentiment,
        confidenceScore: analysisResult.confidenceScore,
      });

      // Update analysis record with results
      await storageService.updateAnalysisRecord(analysisId, {
        status: AnalysisStatus.COMPLETED,
        summary: analysisResult.summary,
        keyTakeaways: analysisResult.keyTakeaways,
        pros: analysisResult.pros,
        cons: analysisResult.cons,
        recommendations: analysisResult.recommendations,
        sentiment: analysisResult.sentiment,
        confidenceScore: analysisResult.confidenceScore,
        completedAt: getCurrentTimestamp(),
      });

      jobLogger.info("Analysis record updated successfully");
    } catch (error) {
      jobLogger.error("Analysis failed", error);

      // Update analysis record with error
      await storageService.updateAnalysisRecord(analysisId, {
        status: AnalysisStatus.FAILED,
        errorMessage: String(error),
      });

      throw error; // Re-throw to trigger retry
    }
  }

  /**
   * Health check endpoint
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    return new Response(
      JSON.stringify({
        status: "healthy",
        service: "analysis",
        version: "1.0.0",
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

/**
 * Export the worker with queue handler
 */
export default {
  async queue(batch: MessageBatch<AnalysisMessage>, env: Env): Promise<void> {
    const worker = new AnalysisWorker();
    return worker.queue(batch, env);
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const worker = new AnalysisWorker();
    return worker.fetch(request, env);
  },
} satisfies ExportedHandler<Env>;

