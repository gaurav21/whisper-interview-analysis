import { Buffer } from "node:buffer";
import type { Ai } from "workers-ai";

export interface Env {
  AI: Ai;
  // If needed, add your KV namespace for storing transcripts.
  // MY_KV_NAMESPACE: KVNamespace;
}


/**
 * Transcribes a single audio chunk using the Whisper‑large‑v3‑turbo model.
 * The function converts the audio chunk to a Base64-encoded string and
 * sends it to the model via the AI binding.
 *
 * @param chunkBuffer - The audio chunk as an ArrayBuffer.
 * @param env - The Cloudflare Worker environment, including the AI binding.
 * @returns The transcription text from the model.
 */
async function transcribeChunk(
  chunkBuffer: ArrayBuffer,
  env: Env,
): Promise<string> {
  const base64 = Buffer.from(chunkBuffer).toString("base64");
  console.log(`Transcribing chunk of size ${chunkBuffer.byteLength} bytes (${Math.round(base64.length / 1024)}KB base64)`);
  
  const res = await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
    audio: base64,
    // Optional parameters (uncomment and set if needed):
    // task: "transcribe",   // or "translate"
    // language: "en",
    // vad_filter: "false",
    // initial_prompt: "Provide context if needed.",
    // prefix: "Transcription:",
  });
  
  console.log('AI response:', res);
  return res.text; // Assumes the transcription result includes a "text" property.
}

/**
 * Splits an ArrayBuffer into chunks of the specified size.
 * Note: This should only be used for raw audio formats (WAV, PCM).
 * Compressed formats (MP3, M4A, etc.) cannot be arbitrarily chunked.
 */
function splitIntoChunks(arrayBuffer: ArrayBuffer, chunkSize: number): ArrayBuffer[] {
  const chunks: ArrayBuffer[] = [];
  for (let i = 0; i < arrayBuffer.byteLength; i += chunkSize) {
    chunks.push(arrayBuffer.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Detects if the audio format can be safely chunked.
 * Compressed formats (MP3, M4A, AAC, OGG) should not be chunked.
 */
function canChunkAudioFormat(contentType: string, audioData: ArrayBuffer): boolean {
  // Check content type
  if (contentType.includes('mp3') || contentType.includes('m4a') || 
      contentType.includes('aac') || contentType.includes('ogg') ||
      contentType.includes('mpeg') || contentType.includes('mp4')) {
    return false;
  }
  
  // Check magic numbers (file signatures)
  const view = new Uint8Array(audioData.slice(0, 12));
  
  // M4A/MP4 (starts with ftyp)
  if (view.length >= 8 && view[4] === 0x66 && view[5] === 0x74 && 
      view[6] === 0x79 && view[7] === 0x70) {
    return false;
  }
  
  // MP3 (starts with ID3 or 0xFF)
  if (view[0] === 0x49 && view[1] === 0x44 && view[2] === 0x33) {
    return false;
  }
  if (view[0] === 0xFF && (view[1] & 0xE0) === 0xE0) {
    return false;
  }
  
  // WAV (starts with RIFF...WAVE)
  if (view.length >= 12 && view[0] === 0x52 && view[1] === 0x49 && 
      view[2] === 0x46 && view[3] === 0x46) {
    return true; // WAV can be chunked
  }
  
  // Default: don't chunk if unsure
  return false;
}

/**
 * The main fetch handler. Supports two modes:
 * 1. GET with 'url' query parameter - fetches audio from URL
 * 2. POST with file in body - accepts direct file upload
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const { searchParams } = new URL(request.url);
    let audioBuffer: ArrayBuffer;
    let contentType = "";
    
    // Maximum file size: 25MB (Cloudflare Workers AI limit)
    const MAX_FILE_SIZE = 25 * 1024 * 1024;

    if (request.method === "POST") {
      // Handle direct file upload
      contentType = request.headers.get("content-type") || "";

      if (contentType.includes("multipart/form-data")) {
        // Handle form-data upload (e.g., from HTML form or curl -F)
        const formData = await request.formData();
        const file = formData.get("file") as File | null;

        if (!file) {
          return new Response("Missing 'file' in form data", { status: 400 });
        }

        audioBuffer = await file.arrayBuffer();
        contentType = file.type || contentType;
      } else {
        // Handle raw binary upload (e.g., curl --data-binary)
        audioBuffer = await request.arrayBuffer();

        if (audioBuffer.byteLength === 0) {
          return new Response("Empty request body", { status: 400 });
        }
      }

      // Validate file size
      if (audioBuffer.byteLength > MAX_FILE_SIZE) {
        return new Response(
          `Error: File size (${Math.round(audioBuffer.byteLength / 1024 / 1024)}MB) exceeds maximum allowed size of 25MB.\n\n` +
          `To transcribe large files, please:\n` +
          `1. Split your audio file into smaller segments using FFmpeg:\n` +
          `   ffmpeg -i input.m4a -f segment -segment_time 300 -c copy output_%03d.m4a\n` +
          `   (This creates 5-minute segments)\n\n` +
          `2. Or convert to a compressed format with lower bitrate:\n` +
          `   ffmpeg -i input.m4a -ar 16000 -ac 1 -b:a 32k output.mp3\n\n` +
          `3. Then upload each segment separately.`,
          { status: 413 }
        );
      }

      console.log(`Processing audio file: ${Math.round(audioBuffer.byteLength / 1024)}KB, type: ${contentType}`);
    } else {
      // Handle GET with URL parameter
      const audioUrl = searchParams.get("url");

      if (!audioUrl) {
        return new Response(
          "🎙️  Whisper Transcription Service\n" +
          "================================\n\n" +
          "Usage:\n" +
          "  GET  ?url=<audio-url>  - Transcribe audio from URL\n" +
          "  POST with file body   - Transcribe uploaded audio file\n\n" +
          "Examples:\n" +
          "  curl 'http://localhost:8787?url=https://example.com/audio.mp3'\n" +
          "  curl -X POST --data-binary @audio.mp3 http://localhost:8787\n" +
          "  curl -X POST -F 'file=@audio.mp3' http://localhost:8787\n\n" +
          "Supported formats: MP3, M4A, WAV, FLAC, OGG\n" +
          "Maximum file size: 25MB\n\n" +
          "For large files, split them first:\n" +
          "  ffmpeg -i input.m4a -f segment -segment_time 300 -c copy output_%03d.m4a",
          { status: 400 }
        );
      }

      try {
        const response = await fetch(audioUrl, { redirect: "follow" });
        if (!response.ok) {
          throw new Error(`Failed to fetch audio: ${response.status}`);
        }
        audioBuffer = await response.arrayBuffer();
        contentType = response.headers.get("content-type") || "";

        if (audioBuffer.byteLength > MAX_FILE_SIZE) {
          return new Response(
            `Error: Downloaded file size (${Math.round(audioBuffer.byteLength / 1024 / 1024)}MB) exceeds 25MB limit.`,
            { status: 413 }
          );
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return new Response(`Error fetching audio: ${errorMessage}`, { status: 400 });
      }
    }

    // For compressed formats (MP3, M4A, etc.), send the entire file
    // Chunking only works for raw/uncompressed audio formats
    const shouldChunk = canChunkAudioFormat(contentType, audioBuffer);
    
    let fullTranscript = "";

    if (shouldChunk && audioBuffer.byteLength > 1024 * 1024) {
      // Only chunk if it's a raw format AND larger than 1MB
      console.log('Using chunked transcription for raw audio format');
      const chunkSize = 1024 * 1024; // 1MB chunks
      const audioChunks = splitIntoChunks(audioBuffer, chunkSize);
      
      for (let i = 0; i < audioChunks.length; i++) {
        try {
          const transcript = await transcribeChunk(audioChunks[i], env);
          fullTranscript += transcript + " ";
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`Error transcribing chunk ${i + 1}/${audioChunks.length}:`, errorMessage);
          fullTranscript += `[Error in chunk ${i + 1}] `;
        }
      }
    } else {
      // Send entire file for compressed formats
      console.log('Sending entire file for transcription');
      try {
        const transcript = await transcribeChunk(audioBuffer, env);
        fullTranscript = transcript;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Error transcribing audio:', errorMessage);
        return new Response(
          `Error: ${errorMessage}\n\n` +
          `If the file is too large or in an unsupported format, try:\n` +
          `1. Converting to a lower bitrate MP3:\n` +
          `   ffmpeg -i input.m4a -ar 16000 -ac 1 -b:a 32k output.mp3\n\n` +
          `2. Splitting into smaller segments:\n` +
          `   ffmpeg -i input.m4a -f segment -segment_time 300 -c copy output_%03d.m4a`,
          { status: 500 }
        );
      }
    }

    return new Response(fullTranscript.trim(), {
      headers: { 
        "Content-Type": "text/plain",
        "X-File-Size": audioBuffer.byteLength.toString(),
        "X-Processing-Mode": shouldChunk ? "chunked" : "whole-file"
      },
    });
  },
} satisfies ExportedHandler<Env>;
