-- Initial schema for interview transcription and analysis system
-- Migration: 0001_initial_schema
-- Created: 2025-12-26

-- Audio files table
CREATE TABLE IF NOT EXISTS audio_files (
    id TEXT PRIMARY KEY,
    original_filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    duration_seconds INTEGER,
    r2_key TEXT NOT NULL,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Transcriptions table
CREATE TABLE IF NOT EXISTS transcriptions (
    id TEXT PRIMARY KEY,
    audio_id TEXT NOT NULL,
    context TEXT NOT NULL CHECK(context IN ('candidate_interview', 'team_meeting', 'general_transcription')),
    status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
    transcript_text TEXT,
    transcript_url TEXT,
    error_message TEXT,
    metadata TEXT, -- JSON string
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (audio_id) REFERENCES audio_files(id) ON DELETE CASCADE
);

-- Analyses table
CREATE TABLE IF NOT EXISTS analyses (
    id TEXT PRIMARY KEY,
    transcription_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
    summary TEXT,
    key_takeaways TEXT, -- JSON array
    pros TEXT, -- JSON array
    cons TEXT, -- JSON array
    recommendations TEXT, -- JSON array
    sentiment TEXT CHECK(sentiment IN ('positive', 'negative', 'neutral', 'mixed')),
    confidence_score REAL,
    llm_model TEXT NOT NULL,
    error_message TEXT,
    metadata TEXT, -- JSON string
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (transcription_id) REFERENCES transcriptions(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_audio_files_uploaded_at ON audio_files(uploaded_at);
CREATE INDEX IF NOT EXISTS idx_transcriptions_audio_id ON transcriptions(audio_id);
CREATE INDEX IF NOT EXISTS idx_transcriptions_status ON transcriptions(status);
CREATE INDEX IF NOT EXISTS idx_transcriptions_context ON transcriptions(context);
CREATE INDEX IF NOT EXISTS idx_transcriptions_created_at ON transcriptions(created_at);
CREATE INDEX IF NOT EXISTS idx_analyses_transcription_id ON analyses(transcription_id);
CREATE INDEX IF NOT EXISTS idx_analyses_status ON analyses(status);
CREATE INDEX IF NOT EXISTS idx_analyses_created_at ON analyses(created_at);

-- Trigger to update updated_at timestamp for transcriptions
CREATE TRIGGER IF NOT EXISTS update_transcriptions_updated_at
AFTER UPDATE ON transcriptions
FOR EACH ROW
BEGIN
    UPDATE transcriptions SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Trigger to update updated_at timestamp for analyses
CREATE TRIGGER IF NOT EXISTS update_analyses_updated_at
AFTER UPDATE ON analyses
FOR EACH ROW
BEGIN
    UPDATE analyses SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

