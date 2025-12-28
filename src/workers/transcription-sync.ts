/**
 * Simplified Transcription Worker - Manual Trigger for Free Tier
 * Works on Cloudflare Free Tier (no R2, no Queues, no background processing)
 * 
 * Flow:
 * 1. POST /upload - Creates job, returns immediately
 * 2. POST /process/{jobId} - Manually triggers transcription + analysis
 * 3. GET /status/{jobId} - Check results
 */

import type {
  Env,
  StatusResponse,
} from "../types";
import {
  ProcessingContext,
  TranscriptionStatus,
  AnalysisStatus,
} from "../types";
import { StorageService } from "../services/storage";
import { TranscriptionService } from "../services/transcription";
import { OpenAIService } from "../services/openai";
import { createLogger } from "../utils/logger";
import {
  generateId,
  getCurrentTimestamp,
  createErrorResponse,
  jsonResponse,
} from "../utils/helpers";
import {
  validateAudioFile,
  validateContext,
  sanitizeFilename,
} from "../utils/validation";

export class SimplifiedTranscriptionWorker {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const logger = createLogger(
      { worker: "transcription-sync" },
      env.ENVIRONMENT
    );

    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (path === "/upload" && request.method === "POST") {
        return await this.handleUpload(request, env, logger);
      }

      if (path.startsWith("/process/") && request.method === "POST") {
        const jobId = path.split("/")[2];
        return await this.handleProcess(jobId, env, logger);
      }

      if (path.startsWith("/status/") && request.method === "GET") {
        const jobId = path.split("/")[2];
        return await this.handleStatus(jobId, env, logger);
      }

      if (path === "/analyze" && request.method === "POST") {
        return await this.handleAnalyze(request, env, logger);
      }

      if (path === "/health" && request.method === "GET") {
        return jsonResponse({ 
          status: "healthy",
          service: "transcription-sync",
          tier: "free",
          features: ["transcription", "inline-analysis", "standalone-analysis"]
        });
      }

      return this.showUsage();
    } catch (error) {
      logger.error("Unhandled error", error);
      return jsonResponse(
        createErrorResponse("INTERNAL_ERROR", "An unexpected error occurred"),
        500
      );
    }
  }

  private async handleUpload(
    request: Request,
    env: Env,
    logger: typeof import("../utils/logger").Logger.prototype
  ): Promise<Response> {
    logger.info("Upload request received");

    try {
      const contentType = request.headers.get("content-type") || "";
      
      if (!contentType.includes("multipart/form-data")) {
        return jsonResponse(
          createErrorResponse(
            "INVALID_REQUEST",
            "Please use multipart/form-data with 'file' and 'context' fields"
          ),
          400
        );
      }

      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      const contextValue = formData.get("context") as string | null;
      const metadataValue = formData.get("metadata") as string | null;

      if (!file || !contextValue) {
        return jsonResponse(
          createErrorResponse("MISSING_FIELDS", "file and context are required"),
          400
        );
      }

      const audioBuffer = await file.arrayBuffer();
      const context = contextValue as ProcessingContext;
      const originalFilename = file.name;
      const fileMimeType = file.type || "application/octet-stream";
      
      let metadata: Record<string, unknown> = {};
      if (metadataValue) {
        try {
          metadata = JSON.parse(metadataValue);
        } catch (e) {
          return jsonResponse(
            createErrorResponse("INVALID_METADATA", "Metadata must be valid JSON"),
            400
          );
        }
      }

      // Validate
      const audioValidation = validateAudioFile(audioBuffer, fileMimeType);
      if (!audioValidation.valid) {
        return jsonResponse(
          createErrorResponse("INVALID_AUDIO", audioValidation.errors!.join(", ")),
          400
        );
      }

      const contextValidation = validateContext(context);
      if (!contextValidation.valid) {
        return jsonResponse(
          createErrorResponse("INVALID_CONTEXT", contextValidation.errors![0]),
          400
        );
      }

      const audioId = generateId();
      const transcriptionId = generateId();
      const fileSizeMB = audioBuffer.byteLength / (1024 * 1024);

      logger.info("Storing upload", { 
        transcriptionId,
        audioId,
        context,
        fileSizeMB: Math.round(fileSizeMB)
      });

      // Store audio buffer in KV (temporary storage for processing)
      await env.CACHE.put(
        `audio:${transcriptionId}`,
        audioBuffer,
        { expirationTtl: 3600 } // 1 hour
      );

      // Store metadata in KV
      await env.CACHE.put(
        `meta:${transcriptionId}`,
        JSON.stringify({ context, metadata }),
        { expirationTtl: 3600 }
      );

      // Create audio file record in D1
      await env.DB.prepare(`
        INSERT INTO audio_files (id, original_filename, mime_type, size_bytes, r2_key, uploaded_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
        .bind(
          audioId,
          sanitizeFilename(originalFilename),
          fileMimeType,
          audioBuffer.byteLength,
          `kv://${transcriptionId}`,
          getCurrentTimestamp()
        )
        .run();

      const storageService = new StorageService(env, logger);
      
      // Create transcription record with PENDING status
      await storageService.createTranscriptionRecord({
        id: transcriptionId,
        audioId,
        context,
        status: TranscriptionStatus.PENDING,
        metadata,
      });

      return jsonResponse({
        success: true,
        jobId: transcriptionId,
        audioId,
        message: "Upload successful. Call POST /process/{jobId} to start transcription.",
        processUrl: `/process/${transcriptionId}`,
        statusUrl: `/status/${transcriptionId}`,
        fileSizeMB: Math.round(fileSizeMB),
        expiresIn: "1 hour"
      }, 201);
    } catch (error) {
      logger.error("Upload failed", error);
      return jsonResponse(
        createErrorResponse(
          "UPLOAD_FAILED",
          "Failed to upload file",
          { error: String(error) }
        ),
        500
      );
    }
  }

  private async handleProcess(
    jobId: string,
    env: Env,
    logger: typeof import("../utils/logger").Logger.prototype
  ): Promise<Response> {
    logger.info("Process request received", { jobId });

    try {
      const storageService = new StorageService(env, logger);

      // Get transcription record
      const transcription = await storageService.getTranscriptionRecord(jobId);
      if (!transcription) {
        return jsonResponse(
          createErrorResponse("NOT_FOUND", `Job ${jobId} not found`),
          404
        );
      }

      if (transcription.status !== TranscriptionStatus.PENDING) {
        return jsonResponse(
          createErrorResponse(
            "INVALID_STATE",
            `Job already ${transcription.status}. Can only process PENDING jobs.`
          ),
          400
        );
      }

      // Retrieve audio buffer from KV
      const audioBuffer = await env.CACHE.get(`audio:${jobId}`, "arrayBuffer");
      if (!audioBuffer) {
        return jsonResponse(
          createErrorResponse(
            "AUDIO_EXPIRED",
            "Audio file expired. Please re-upload. (Files expire after 1 hour)"
          ),
          410
        );
      }

      // Retrieve metadata from KV
      const metaStr = await env.CACHE.get(`meta:${jobId}`, "text");
      const { context, metadata } = metaStr ? JSON.parse(metaStr) : { context: transcription.context, metadata: {} };

      // Update status to PROCESSING
      await storageService.updateTranscriptionRecord(jobId, {
        status: TranscriptionStatus.PROCESSING,
      });

      logger.info("Starting transcription", { jobId });

      // Run transcription
      const transcriptionService = new TranscriptionService(env, logger);
      const transcriptText = await transcriptionService.transcribe(audioBuffer);

      await storageService.updateTranscriptionRecord(jobId, {
        status: TranscriptionStatus.COMPLETED,
        transcriptText,
        completedAt: getCurrentTimestamp(),
      });

      logger.info("Transcription completed", { jobId });

      // Run analysis if interview/meeting
      if (
        context === ProcessingContext.CANDIDATE_INTERVIEW ||
        context === ProcessingContext.TEAM_MEETING
      ) {
        await this.runAnalysis(jobId, transcriptText, context, metadata, env, logger);
      }

      // Clean up KV storage
      await env.CACHE.delete(`audio:${jobId}`);
      await env.CACHE.delete(`meta:${jobId}`);

      return await this.handleStatus(jobId, env, logger);
    } catch (error) {
      logger.error("Processing failed", error);

      const storageService = new StorageService(env, logger);
      await storageService.updateTranscriptionRecord(jobId, {
        status: TranscriptionStatus.FAILED,
        errorMessage: String(error),
      });

      return jsonResponse(
        createErrorResponse(
          "PROCESSING_FAILED",
          "Failed to process audio",
          { error: String(error) }
        ),
        500
      );
    }
  }

  private async runAnalysis(
    transcriptionId: string,
    transcriptText: string,
    context: ProcessingContext,
    metadata: Record<string, unknown>,
    env: Env,
    logger: typeof import("../utils/logger").Logger.prototype
  ): Promise<void> {
    const analysisId = generateId();
    const storageService = new StorageService(env, logger);

    await storageService.createAnalysisRecord({
      id: analysisId,
      transcriptionId,
      status: AnalysisStatus.PROCESSING,
      llmModel: "gpt-4o-mini",
    });

    try {
      const openaiService = new OpenAIService(env, logger);

      const analysisResult = context === ProcessingContext.CANDIDATE_INTERVIEW
        ? await openaiService.analyzeInterview(transcriptText, metadata)
        : await openaiService.analyzeMeeting(transcriptText, metadata);

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
    } catch (error) {
      logger.error("Analysis failed", error);
      await storageService.updateAnalysisRecord(analysisId, {
        status: AnalysisStatus.FAILED,
        errorMessage: String(error),
      });
    }
  }

  private async handleAnalyze(
    request: Request,
    env: Env,
    logger: typeof import("../utils/logger").Logger.prototype
  ): Promise<Response> {
    logger.info("Analyze request received");

    try {
      // Parse request body
      const body = await request.json() as {
        transcript: string;
        context: ProcessingContext;
        metadata?: Record<string, unknown>;
      };

      const { transcript, context, metadata = {} } = body;

      if (!transcript || !context) {
        return jsonResponse(
          createErrorResponse("MISSING_FIELDS", "transcript and context are required"),
          400
        );
      }

      // Validate context
      const contextValidation = validateContext(context);
      if (!contextValidation.valid) {
        return jsonResponse(
          createErrorResponse("INVALID_CONTEXT", contextValidation.errors![0]),
          400
        );
      }

      logger.info("Running analysis", {
        transcriptLength: transcript.length,
        context,
      });

      // Run analysis based on context
      const openaiService = new OpenAIService(env, logger);
      
      let analysisResult;
      if (context === ProcessingContext.CANDIDATE_INTERVIEW) {
        analysisResult = await openaiService.analyzeInterview(transcript, metadata);
      } else if (context === ProcessingContext.TEAM_MEETING) {
        analysisResult = await openaiService.analyzeMeeting(transcript, metadata);
      } else {
        return jsonResponse(
          createErrorResponse(
            "INVALID_CONTEXT",
            "Analysis only supports candidate_interview and team_meeting contexts"
          ),
          400
        );
      }

      logger.info("Analysis completed", {
        sentiment: analysisResult.sentiment,
        confidenceScore: analysisResult.confidenceScore,
      });

      return jsonResponse({
        success: true,
        analysis: {
          summary: analysisResult.summary,
          keyTakeaways: analysisResult.keyTakeaways,
          pros: analysisResult.pros,
          cons: analysisResult.cons,
          recommendations: analysisResult.recommendations,
          sentiment: analysisResult.sentiment,
          confidenceScore: analysisResult.confidenceScore,
        },
      });
    } catch (error) {
      logger.error("Analysis failed", error);
      return jsonResponse(
        createErrorResponse(
          "ANALYSIS_FAILED",
          "Failed to analyze transcript",
          { error: String(error) }
        ),
        500
      );
    }
  }

  private async handleStatus(
    jobId: string,
    env: Env,
    logger: typeof import("../utils/logger").Logger.prototype
  ): Promise<Response> {
    try {
      const storageService = new StorageService(env, logger);

      const transcription = await storageService.getTranscriptionRecord(jobId);
      if (!transcription) {
        return jsonResponse(
          createErrorResponse("NOT_FOUND", `Job ${jobId} not found`),
          404
        );
      }

      const analysis = await storageService.getAnalysisRecord(jobId);

      const response: StatusResponse = {
        jobId: transcription.id,
        audioId: transcription.audioId,
        context: transcription.context,
        transcription: {
          status: transcription.status,
          text: transcription.transcriptText,
          url: transcription.transcriptUrl,
          error: transcription.errorMessage,
        },
        createdAt: transcription.createdAt,
        updatedAt: transcription.updatedAt,
      };

      if (analysis) {
        response.analysis = {
          status: analysis.status,
          summary: analysis.summary,
          keyTakeaways: analysis.keyTakeaways,
          pros: analysis.pros,
          cons: analysis.cons,
          recommendations: analysis.recommendations,
          sentiment: analysis.sentiment,
          error: analysis.errorMessage,
        };
      }

      return jsonResponse(response);
    } catch (error) {
      logger.error("Status check failed", error);
      return jsonResponse(
        createErrorResponse("STATUS_CHECK_FAILED", "Failed to retrieve status"),
        500
      );
    }
  }

  private showUsage(): Response {
    return jsonResponse({
      service: "Transcription API (Free Tier - Manual Trigger)",
      version: "2.1.0",
      workflow: {
        step1: "Upload file (returns immediately)",
        step2: "Call /process/{jobId} to start transcription",
        step3: "Check /status/{jobId} for results",
        alternative: "Or use /analyze for pre-transcribed text",
      },
      endpoints: {
        upload: {
          method: "POST",
          path: "/upload",
          description: "Upload audio file (stored for 1 hour)",
          example:
            'curl -X POST -F "file=@audio.m4a" -F "context=candidate_interview" -F \'metadata={"candidateName":"John"}\' https://your-worker.workers.dev/upload',
        },
        process: {
          method: "POST",
          path: "/process/{jobId}",
          description: "Trigger transcription + analysis (may take 30-60s)",
          example:
            'curl -X POST https://your-worker.workers.dev/process/{jobId}',
        },
        analyze: {
          method: "POST",
          path: "/analyze",
          description: "Analyze existing transcript (no audio needed)",
          example:
            'curl -X POST https://your-worker.workers.dev/analyze -H "Content-Type: application/json" -d \'{"transcript":"...","context":"candidate_interview","metadata":{"candidateName":"John"}}\'',
        },
        status: {
          method: "GET",
          path: "/status/{jobId}",
          description: "Check processing status and get results",
        },
        health: {
          method: "GET",
          path: "/health",
        },
      },
      limits: {
        maxSize: "25MB per file",
        storageExpiry: "1 hour after upload",
        processingTime: "30-60 seconds for typical audio",
        transcriptSize: "Up to ~100K characters",
      },
      contexts: ["candidate_interview", "team_meeting", "general_transcription"],
    });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const worker = new SimplifiedTranscriptionWorker();
    return worker.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
