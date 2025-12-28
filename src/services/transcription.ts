/**
 * Transcription service using Cloudflare Workers AI (Whisper)
 */

import { Buffer } from "node:buffer";
import type { Env, ITranscriptionService } from "../types";
import { Logger } from "../utils/logger";
import { retryWithBackoff } from "../utils/helpers";

export class TranscriptionService implements ITranscriptionService {
  private env: Env;
  private logger: Logger;
  private model: string;

  constructor(env: Env, logger: Logger) {
    this.env = env;
    this.logger = logger.child({ service: "TranscriptionService" });
    this.model = "@cf/openai/whisper-large-v3-turbo";
  }

  /**
   * Transcribes audio buffer using Whisper model
   */
  async transcribe(audioBuffer: ArrayBuffer): Promise<string> {
    this.logger.info("Starting transcription", {
      bufferSize: audioBuffer.byteLength,
      model: this.model,
    });

    const startTime = Date.now();

    try {
      const transcript = await retryWithBackoff(async () => {
        return await this.transcribeChunk(audioBuffer);
      }, 3, 2000);

      const duration = Date.now() - startTime;
      this.logger.info("Transcription completed", {
        duration: `${duration}ms`,
        transcriptLength: transcript.length,
      });

      return transcript;
    } catch (error) {
      this.logger.error("Transcription failed", error);
      throw new Error(`Transcription failed: ${error}`);
    }
  }

  /**
   * Transcribes a single audio chunk
   */
  private async transcribeChunk(chunkBuffer: ArrayBuffer): Promise<string> {
    const base64 = Buffer.from(chunkBuffer).toString("base64");
    
    this.logger.debug("Sending audio to Whisper", {
      chunkSize: chunkBuffer.byteLength,
      base64Size: base64.length,
    });

    const res = await this.env.AI.run(this.model, {
      audio: base64,
    });

    if (!res || !res.text) {
      throw new Error("No transcription text returned from Whisper");
    }

    return res.text;
  }
}

