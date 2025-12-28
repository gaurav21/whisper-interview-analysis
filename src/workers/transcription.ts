/**
 * Transcription Worker - Handles audio upload and transcription
 */

import type {
  Env,
  TranscriptionRequest,
  TranscriptionResponse,
  StatusResponse,
  ProcessingContext,
  TranscriptionStatus,
  AnalysisStatus,
  AnalysisMessage,
} from "../types";
import { StorageService } from "../services/storage";
import { TranscriptionService } from "../services/transcription";
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
  validateMetadata,
  sanitizeFilename,
} from "../utils/validation";

export class TranscriptionWorker {
  /**
   * Handles incoming HTTP requests
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const logger = createLogger(
      { worker: "transcription" },
      env.ENVIRONMENT
    );

    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // Route requests
      if (path === "/upload" && request.method === "POST") {
        return await this.handleUpload(request, env, logger);
      }

      if (path.startsWith("/status/") && request.method === "GET") {
        const jobId = path.split("/")[2];
        return await this.handleStatus(jobId, env, logger);
      }

      if (path === "/health" && request.method === "GET") {
        return jsonResponse({ status: "healthy", service: "transcription" });
      }

      // Default: Show usage
      return this.showUsage();
    } catch (error) {
      logger.error("Unhandled error in transcription worker", error);
      return jsonResponse(
        createErrorResponse(
          "INTERNAL_ERROR",
          "An unexpected error occurred",
          { error: String(error) }
        ),
        500
      );
    }
  }

  /**
   * Handles audio upload and initiates transcription
   */
  private async handleUpload(
    request: Request,
    env: Env,
    logger: typeof import("../utils/logger").Logger.prototype
  ): Promise<Response> {
    logger.info("Upload request received");

    try {
      // Parse context and metadata from headers or form data
      const contentType = request.headers.get("content-type") || "";
      let audioBuffer: ArrayBuffer;
      let context: ProcessingContext;
      let metadata: Record<string, unknown> = {};
      let originalFilename = "audio-file";
      let fileMimeType = contentType;

      if (contentType.includes("multipart/form-data")) {
        // Form data upload
        const formData = await request.formData();
        const file = formData.get("file") as File | null;
        const contextValue = formData.get("context") as string | null;
        const metadataValue = formData.get("metadata") as string | null;

        if (!file) {
          return jsonResponse(
            createErrorResponse("MISSING_FILE", "No file provided in form data"),
            400
          );
        }

        if (!contextValue) {
          return jsonResponse(
            createErrorResponse(
              "MISSING_CONTEXT",
              "Context is required (candidate_interview, team_meeting, or general_transcription)"
            ),
            400
          );
        }

        audioBuffer = await file.arrayBuffer();
        context = contextValue as ProcessingContext;
        originalFilename = file.name;
        fileMimeType = file.type || contentType;

        if (metadataValue) {
          try {
            metadata = JSON.parse(metadataValue);
          } catch {
            return jsonResponse(
              createErrorResponse("INVALID_METADATA", "Metadata must be valid JSON"),
              400
            );
          }
        }
      } else {
        // Raw binary upload with headers
        audioBuffer = await request.arrayBuffer();
        const contextHeader = request.headers.get("x-context");
        const metadataHeader = request.headers.get("x-metadata");
        const filenameHeader = request.headers.get("x-filename");

        if (!contextHeader) {
          return jsonResponse(
            createErrorResponse(
              "MISSING_CONTEXT",
              "Context header (x-context) is required"
            ),
            400
          );
        }

        context = contextHeader as ProcessingContext;

        if (filenameHeader) {
          originalFilename = filenameHeader;
        }

        if (metadataHeader) {
          try {
            metadata = JSON.parse(metadataHeader);
          } catch {
            return jsonResponse(
              createErrorResponse("INVALID_METADATA", "Metadata must be valid JSON"),
              400
            );
          }
        }
      }

      // Validate inputs
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

      const metadataValidation = validateMetadata(metadata);
      if (!metadataValidation.valid) {
        return jsonResponse(
          createErrorResponse(
            "INVALID_METADATA",
            metadataValidation.errors![0]
          ),
          400
        );
      }

      // Generate IDs
      const audioId = generateId();
      const transcriptionId = generateId();

      logger.info("Processing upload", {
        audioId,
        transcriptionId,
        context,
        fileSize: audioBuffer.byteLength,
      });

      // Initialize services
      const storageService = new StorageService(env, logger);
      const transcriptionService = new TranscriptionService(env, logger);

      // Save audio file to R2
      await storageService.saveAudioFile(audioId, audioBuffer, {
        id: audioId,
        originalFilename: sanitizeFilename(originalFilename),
        mimeType: fileMimeType,
        sizeBytes: audioBuffer.byteLength,
        uploadedAt: getCurrentTimestamp(),
      });

      // Create transcription record
      await storageService.createTranscriptionRecord({
        id: transcriptionId,
        audioId,
        context,
        status: TranscriptionStatus.PROCESSING,
        metadata,
      });

      // Start transcription asynchronously
      ctx.waitUntil(
        this.processTranscription(
          transcriptionId,
          audioId,
          audioBuffer,
          context,
          env,
          logger
        )
      );

      // Return immediate response
      const response: TranscriptionResponse = {
        success: true,
        jobId: transcriptionId,
        audioId,
        message: "Transcription started. Check status for progress.",
        statusUrl: `/status/${transcriptionId}`,
      };

      logger.info("Upload processed successfully", {
        transcriptionId,
        audioId,
      });

      return jsonResponse(response, 202);
    } catch (error) {
      logger.error("Upload processing failed", error);
      return jsonResponse(
        createErrorResponse(
          "UPLOAD_FAILED",
          "Failed to process upload",
          { error: String(error) }
        ),
        500
      );
    }
  }

  /**
   * Processes transcription asynchronously
   */
  private async processTranscription(
    transcriptionId: string,
    audioId: string,
    audioBuffer: ArrayBuffer,
    context: ProcessingContext,
    env: Env,
    logger: typeof import("../utils/logger").Logger.prototype
  ): Promise<void> {
    const jobLogger = logger.child({ transcriptionId, audioId });

    try {
      jobLogger.info("Starting transcription processing");

      const storageService = new StorageService(env, jobLogger);
      const transcriptionService = new TranscriptionService(env, jobLogger);

      // Perform transcription
      const transcriptText = await transcriptionService.transcribe(audioBuffer);

      // Save transcript to R2
      const transcriptUrl = await storageService.saveTranscript(
        transcriptionId,
        transcriptText
      );

      // Update transcription record
      await storageService.updateTranscriptionRecord(transcriptionId, {
        status: TranscriptionStatus.COMPLETED,
        transcriptText,
        transcriptUrl,
        completedAt: getCurrentTimestamp(),
      });

      jobLogger.info("Transcription completed successfully");

      // Queue analysis for interview/meeting contexts
      if (
        context === ProcessingContext.CANDIDATE_INTERVIEW ||
        context === ProcessingContext.TEAM_MEETING
      ) {
        jobLogger.info("Queueing analysis job");

        const transcriptionRecord = await storageService.getTranscriptionRecord(
          transcriptionId
        );

        const analysisMessage: AnalysisMessage = {
          transcriptionId,
          context,
          audioId,
          metadata: transcriptionRecord?.metadata,
        };

        await env.ANALYSIS_QUEUE.send(analysisMessage);

        jobLogger.info("Analysis job queued");
      }
    } catch (error) {
      jobLogger.error("Transcription processing failed", error);

      const storageService = new StorageService(env, jobLogger);
      await storageService.updateTranscriptionRecord(transcriptionId, {
        status: TranscriptionStatus.FAILED,
        errorMessage: String(error),
      });
    }
  }

  /**
   * Handles status check requests
   */
  private async handleStatus(
    jobId: string,
    env: Env,
    logger: typeof import("../utils/logger").Logger.prototype
  ): Promise<Response> {
    logger.info("Status check requested", { jobId });

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

      // Get analysis record if applicable
      const analysis = await storageService.getAnalysisRecord(jobId);

      // Build response
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
      logger.error("Status check failed", error, { jobId });
      return jsonResponse(
        createErrorResponse(
          "STATUS_CHECK_FAILED",
          "Failed to retrieve status",
          { error: String(error) }
        ),
        500
      );
    }
  }

  /**
   * Shows API usage information
   */
  private showUsage(): Response {
    const usage = {
      service: "Transcription API",
      version: "1.0.0",
      endpoints: {
        upload: {
          method: "POST",
          path: "/upload",
          description: "Upload audio file for transcription",
          contentType: "multipart/form-data or application/octet-stream",
          formFields: {
            file: "Audio file (required)",
            context:
              "Processing context: candidate_interview, team_meeting, or general_transcription (required)",
            metadata: "JSON metadata (optional)",
          },
          headers: {
            "x-context": "For binary uploads: Processing context (required)",
            "x-metadata": "For binary uploads: JSON metadata (optional)",
            "x-filename": "For binary uploads: Original filename (optional)",
          },
        },
        status: {
          method: "GET",
          path: "/status/{jobId}",
          description: "Check transcription and analysis status",
        },
        health: {
          method: "GET",
          path: "/health",
          description: "Health check endpoint",
        },
      },
      examples: {
        formDataUpload: `curl -X POST https://your-worker.workers.dev/upload \\
  -F "file=@interview.m4a" \\
  -F "context=candidate_interview" \\
  -F 'metadata={"candidateName":"John Doe","position":"Senior Engineer"}'`,
        binaryUpload: `curl -X POST https://your-worker.workers.dev/upload \\
  -H "x-context: candidate_interview" \\
  -H 'x-metadata: {"candidateName":"John Doe"}' \\
  -H "x-filename: interview.m4a" \\
  --data-binary @interview.m4a`,
        statusCheck: `curl https://your-worker.workers.dev/status/{jobId}`,
      },
    };

    return jsonResponse(usage);
  }
}

/**
 * Export the worker
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const worker = new TranscriptionWorker();
    return worker.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

