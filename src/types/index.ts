/**
 * Core TypeScript types for the interview transcription and analysis system
 */

import type { Ai } from "workers-ai";

/**
 * Environment bindings for Cloudflare Workers
 */
export interface Env {
  // AI binding for Whisper transcription
  AI: Ai;
  
  // R2 bucket for audio files and transcripts
  AUDIO_BUCKET: R2Bucket;
  
  // D1 database for structured data
  DB: D1Database;
  
  // Queue for async processing
  ANALYSIS_QUEUE: Queue<AnalysisMessage>;
  
  // KV for caching and metadata
  CACHE: KVNamespace;
  
  // OpenAI API key (stored as secret)
  OPENAI_API_KEY: string;
  
  // Optional: Environment name (dev, staging, prod)
  ENVIRONMENT?: string;
}

/**
 * Context types for different audio processing scenarios
 */
export enum ProcessingContext {
  CANDIDATE_INTERVIEW = "candidate_interview",
  TEAM_MEETING = "team_meeting",
  GENERAL_TRANSCRIPTION = "general_transcription",
}

/**
 * Status of a transcription job
 */
export enum TranscriptionStatus {
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
}

/**
 * Status of an analysis job
 */
export enum AnalysisStatus {
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
}

/**
 * Audio file metadata
 */
export interface AudioMetadata {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number;
  uploadedAt: string;
}

/**
 * Transcription record stored in D1
 */
export interface TranscriptionRecord {
  id: string;
  audioId: string;
  context: ProcessingContext;
  status: TranscriptionStatus;
  transcriptText?: string;
  transcriptUrl?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

/**
 * Analysis record stored in D1
 */
export interface AnalysisRecord {
  id: string;
  transcriptionId: string;
  status: AnalysisStatus;
  summary?: string;
  keyTakeaways?: string[];
  pros?: string[];
  cons?: string[];
  recommendations?: string[];
  sentiment?: string;
  confidenceScore?: number;
  llmModel: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

/**
 * Message format for analysis queue
 */
export interface AnalysisMessage {
  transcriptionId: string;
  context: ProcessingContext;
  audioId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Request body for transcription upload
 */
export interface TranscriptionRequest {
  context: ProcessingContext;
  metadata?: {
    candidateName?: string;
    position?: string;
    interviewer?: string;
    date?: string;
    [key: string]: unknown;
  };
}

/**
 * Response for transcription upload
 */
export interface TranscriptionResponse {
  success: boolean;
  jobId: string;
  audioId: string;
  message: string;
  statusUrl: string;
}

/**
 * Response for status check
 */
export interface StatusResponse {
  jobId: string;
  audioId: string;
  context: ProcessingContext;
  transcription: {
    status: TranscriptionStatus;
    text?: string;
    url?: string;
    error?: string;
  };
  analysis?: {
    status: AnalysisStatus;
    summary?: string;
    keyTakeaways?: string[];
    pros?: string[];
    cons?: string[];
    recommendations?: string[];
    sentiment?: string;
    error?: string;
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * OpenAI chat message format
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * OpenAI API response
 */
export interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Analysis result from LLM
 */
export interface AnalysisResult {
  summary: string;
  keyTakeaways: string[];
  pros: string[];
  cons: string[];
  recommendations: string[];
  sentiment: "positive" | "negative" | "neutral" | "mixed";
  confidenceScore: number;
}

/**
 * Error response format
 */
export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  timestamp: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

/**
 * Storage service interface
 */
export interface IStorageService {
  saveAudioFile(id: string, buffer: ArrayBuffer, metadata: AudioMetadata): Promise<void>;
  saveTranscript(id: string, text: string): Promise<string>;
  getTranscript(id: string): Promise<string | null>;
  createTranscriptionRecord(record: Omit<TranscriptionRecord, "createdAt" | "updatedAt">): Promise<void>;
  updateTranscriptionRecord(id: string, updates: Partial<TranscriptionRecord>): Promise<void>;
  getTranscriptionRecord(id: string): Promise<TranscriptionRecord | null>;
  createAnalysisRecord(record: Omit<AnalysisRecord, "createdAt" | "updatedAt">): Promise<void>;
  updateAnalysisRecord(id: string, updates: Partial<AnalysisRecord>): Promise<void>;
  getAnalysisRecord(transcriptionId: string): Promise<AnalysisRecord | null>;
}

/**
 * LLM service interface
 */
export interface ILLMService {
  analyzeInterview(transcript: string, metadata?: Record<string, unknown>): Promise<AnalysisResult>;
  analyzeMeeting(transcript: string, metadata?: Record<string, unknown>): Promise<AnalysisResult>;
}

/**
 * Transcription service interface
 */
export interface ITranscriptionService {
  transcribe(audioBuffer: ArrayBuffer): Promise<string>;
}

