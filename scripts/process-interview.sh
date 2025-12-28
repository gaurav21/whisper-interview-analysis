#!/bin/bash

################################################################################
# Interview Transcription & Analysis Script
# 
# This script uploads an audio file, triggers transcription + AI analysis,
# and displays the results in a formatted output.
#
# Usage:
#   ./scripts/process-interview.sh <audio_file> <candidate_name> <role>
#
# Example:
#   ./scripts/process-interview.sh interview.m4a "John Doe" "Senior DevOps Engineer"
################################################################################

set -e  # Exit on error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Configuration
WORKER_URL="${WORKER_URL:-https://whisper-transcription-free.gaurav-sharma-a7e.workers.dev}"
CONTEXT="candidate_interview"

################################################################################
# Helper Functions
################################################################################

print_header() {
    echo ""
    echo -e "${CYAN}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}${BOLD}  $1${NC}"
    echo -e "${CYAN}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
}

print_step() {
    echo -e "${BLUE}${BOLD}▶ $1${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ ERROR: $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

print_result() {
    echo -e "${MAGENTA}  $1${NC}"
}

show_usage() {
    echo -e "${BOLD}Usage:${NC}"
    echo "  $0 <audio_file> <candidate_name> <role>"
    echo ""
    echo -e "${BOLD}Arguments:${NC}"
    echo "  audio_file       Path to the audio file (M4A, MP3, WAV, etc.)"
    echo "  candidate_name   Full name of the candidate"
    echo "  role            Position being interviewed for"
    echo ""
    echo -e "${BOLD}Example:${NC}"
    echo "  $0 interview.m4a \"Jane Smith\" \"Senior Backend Engineer\""
    echo ""
    echo -e "${BOLD}Environment Variables:${NC}"
    echo "  WORKER_URL       Override the default worker URL"
    echo "                   Default: $WORKER_URL"
    echo ""
}

format_time() {
    local seconds=$1
    if [ $seconds -lt 60 ]; then
        echo "${seconds}s"
    else
        local minutes=$((seconds / 60))
        local remaining=$((seconds % 60))
        echo "${minutes}m ${remaining}s"
    fi
}

get_file_size_mb() {
    local file="$1"
    local size_bytes=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null)
    echo $((size_bytes / 1024 / 1024))
}

split_audio_file() {
    local input_file="$1"
    local output_dir="$2"
    local chunk_duration=600  # 10 minutes per chunk
    
    print_info "Splitting large audio file into chunks..." >&2
    print_info "Chunk duration: ${chunk_duration}s (10 minutes)" >&2
    
    # Create temp directory for chunks
    mkdir -p "$output_dir"
    
    # Split using FFmpeg with overlap
    ffmpeg -i "$input_file" \
        -f segment \
        -segment_time $chunk_duration \
        -ar 16000 \
        -ac 1 \
        -b:a 32k \
        -reset_timestamps 1 \
        "$output_dir/chunk_%03d.mp3" \
        -loglevel error -y
    
    if [ $? -ne 0 ]; then
        print_error "Failed to split audio file" >&2
        print_info "Make sure FFmpeg is installed: brew install ffmpeg" >&2
        exit 1
    fi
    
    local chunk_count=$(ls -1 "$output_dir"/chunk_*.mp3 2>/dev/null | wc -l | tr -d ' ')
    print_success "Split into $chunk_count chunks" >&2
    
    echo "$chunk_count"
}

process_audio_chunk() {
    local chunk_file="$1"
    local chunk_num="$2"
    local total_chunks="$3"
    
    print_step "Processing chunk $chunk_num/$total_chunks..."
    
    # Upload chunk
    local upload_response=$(curl -s -w "\n%{http_code}" -X POST "$WORKER_URL/upload" \
        -F "file=@$chunk_file" \
        -F "context=general_transcription" \
        -F "metadata={\"chunk\":$chunk_num,\"totalChunks\":$total_chunks}")
    
    local http_status=$(echo "$upload_response" | tail -n1)
    local response_body=$(echo "$upload_response" | sed '$d')
    
    if [ "$http_status" != "201" ]; then
        print_error "Chunk upload failed with status $http_status"
        echo "$response_body"
        return 1
    fi
    
    local job_id=$(echo "$response_body" | jq -r '.jobId')
    
    # Process chunk
    local process_response=$(curl -s -X POST --max-time 120 "$WORKER_URL/process/$job_id")
    
    # Extract transcript
    local transcript=$(echo "$process_response" | jq -r '.transcription.text // ""')
    
    if [ -z "$transcript" ]; then
        print_error "Failed to transcribe chunk $chunk_num"
        return 1
    fi
    
    print_success "Chunk $chunk_num transcribed (${#transcript} chars)"
    echo "$transcript"
}

################################################################################
# Main Script
################################################################################

# Check arguments
if [ $# -lt 3 ]; then
    print_error "Missing required arguments"
    echo ""
    show_usage
    exit 1
fi

AUDIO_FILE="$1"
CANDIDATE_NAME="$2"
ROLE="$3"

# Validate audio file exists
if [ ! -f "$AUDIO_FILE" ]; then
    print_error "Audio file not found: $AUDIO_FILE"
    exit 1
fi

# Get file info
FILE_SIZE=$(du -h "$AUDIO_FILE" | cut -f1)
FILE_SIZE_MB=$(get_file_size_mb "$AUDIO_FILE")
FILE_NAME=$(basename "$AUDIO_FILE")
NEEDS_SPLITTING=false

# Check if file needs splitting (>25MB)
if [ $FILE_SIZE_MB -gt 25 ]; then
    NEEDS_SPLITTING=true
    print_header "LARGE FILE DETECTED - AUTO-SPLIT MODE"
    print_info "File size: ${FILE_SIZE} (${FILE_SIZE_MB}MB)"
    print_info "Maximum size: 25MB"
    print_info "Solution: Automatic splitting into 10-minute chunks"
    echo ""
else
    print_header "INTERVIEW ANALYSIS PIPELINE"
fi

echo -e "${BOLD}Configuration:${NC}"
echo "  Audio File:    $FILE_NAME"
echo "  File Size:     $FILE_SIZE (${FILE_SIZE_MB}MB)"
echo "  Candidate:     $CANDIDATE_NAME"
echo "  Role:          $ROLE"
echo "  Context:       $CONTEXT"
echo "  Worker URL:    $WORKER_URL"
if [ "$NEEDS_SPLITTING" = true ]; then
    echo "  Mode:          🔪 AUTO-SPLIT (Large File)"
else
    echo "  Mode:          📤 DIRECT UPLOAD"
fi
echo ""

################################################################################
# Handle Large Files with Auto-Split
################################################################################

if [ "$NEEDS_SPLITTING" = true ]; then
    print_step "LARGE FILE MODE: Splitting and processing chunks..."
    START_TIME=$(date +%s)
    
    # Create temp directory for chunks
    CHUNK_DIR=$(mktemp -d)
    trap "rm -rf $CHUNK_DIR" EXIT
    
    # Split the audio file
    TOTAL_CHUNKS=$(split_audio_file "$AUDIO_FILE" "$CHUNK_DIR")
    
    if [ -z "$TOTAL_CHUNKS" ] || [ "$TOTAL_CHUNKS" -eq 0 ]; then
        print_error "Failed to split audio file"
        exit 1
    fi
    
    print_info "Processing $TOTAL_CHUNKS chunks..."
    echo ""
    
    # Process each chunk and collect transcripts
    MERGED_TRANSCRIPT=""
    CHUNK_NUM=1
    
    for chunk_file in "$CHUNK_DIR"/chunk_*.mp3; do
        if [ ! -f "$chunk_file" ]; then
            continue
        fi
        
        chunk_transcript=$(process_audio_chunk "$chunk_file" "$CHUNK_NUM" "$TOTAL_CHUNKS")
        
        if [ $? -ne 0 ]; then
            print_error "Failed to process chunk $CHUNK_NUM"
            exit 1
        fi
        
        # Append transcript with marker
        if [ -n "$MERGED_TRANSCRIPT" ]; then
            MERGED_TRANSCRIPT="$MERGED_TRANSCRIPT $chunk_transcript"
        else
            MERGED_TRANSCRIPT="$chunk_transcript"
        fi
        
        CHUNK_NUM=$((CHUNK_NUM + 1))
    done
    
    PROCESS_TIME=$(($(date +%s) - START_TIME))
    
    print_success "All chunks processed in $(format_time $PROCESS_TIME)"
    print_info "Merged transcript: ${#MERGED_TRANSCRIPT} characters"
    echo ""
    
    # Now run AI analysis on merged transcript using Cloudflare Worker
    print_step "Running AI analysis on complete transcript..."
    
    # Prepare metadata
    METADATA=$(jq -n \
        --arg name "$CANDIDATE_NAME" \
        --arg role "$ROLE" \
        --arg chunks "$TOTAL_CHUNKS" \
        '{candidateName: $name, role: $role, processedChunks: $chunks}')
    
    # Prepare analysis payload
    ANALYSIS_PAYLOAD=$(jq -n \
        --arg transcript "$MERGED_TRANSCRIPT" \
        --arg context "$CONTEXT" \
        --argjson metadata "$METADATA" \
        '{
            transcript: $transcript,
            context: $context,
            metadata: $metadata
        }')
    
    # Call Cloudflare Worker's /analyze endpoint
    print_info "Calling Cloudflare Worker for analysis..."
    ANALYSIS_RESPONSE=$(curl -s -X POST "$WORKER_URL/analyze" \
        -H "Content-Type: application/json" \
        -d "$ANALYSIS_PAYLOAD")
    
    # Check if analysis succeeded
    ANALYSIS_SUCCESS=$(echo "$ANALYSIS_RESPONSE" | jq -r '.success // false')
    
    if [ "$ANALYSIS_SUCCESS" = "true" ]; then
        print_success "AI analysis completed!"
        
        # Extract analysis data
        ANALYSIS_DATA=$(echo "$ANALYSIS_RESPONSE" | jq '.analysis')
        
        # Create full response structure
        PROCESS_RESPONSE=$(jq -n \
            --arg jobId "chunked-$(date +%s)" \
            --arg audioId "chunked-$(date +%s)" \
            --arg context "$CONTEXT" \
            --arg transcript "$MERGED_TRANSCRIPT" \
            --argjson analysis "$ANALYSIS_DATA" \
            --arg created "$(date -u +%Y-%m-%d\ %H:%M:%S)" \
            '{
                jobId: $jobId,
                audioId: $audioId,
                context: $context,
                transcription: {
                    status: "completed",
                    text: $transcript
                },
                createdAt: $created,
                updatedAt: $created,
                analysis: ($analysis + {status: "completed"})
            }')
        
        TRANSCRIPTION_STATUS="completed"
        ANALYSIS_STATUS="completed"
        SKIP_ANALYSIS=false
    else
        print_error "Analysis failed"
        echo "$ANALYSIS_RESPONSE" | jq '.error' 2>/dev/null || echo "$ANALYSIS_RESPONSE"
        SKIP_ANALYSIS=true
    fi
    
fi

# Display results for large files
if [ "$NEEDS_SPLITTING" = true ]; then
    if [ "$SKIP_ANALYSIS" = true ] || [ "$ANALYSIS_STATUS" != "completed" ]; then
        # Transcript only mode
        print_header "TRANSCRIPTION COMPLETE (CHUNKED MODE)"
        
        echo -e "${BOLD}Results:${NC}"
        echo "  Chunks Processed:  $TOTAL_CHUNKS"
        echo "  Total Time:        $(format_time $PROCESS_TIME)"
        echo "  Transcript Length: ${#MERGED_TRANSCRIPT} characters"
        echo ""
        
        # Save transcript
        OUTPUT_DIR="results"
        mkdir -p "$OUTPUT_DIR"
        TIMESTAMP=$(date +%Y%m%d_%H%M%S)
        SANITIZED_NAME=$(echo "$CANDIDATE_NAME" | tr ' ' '_' | tr -cd '[:alnum:]_-')
        TRANSCRIPT_FILE="$OUTPUT_DIR/${TIMESTAMP}_${SANITIZED_NAME}_transcript_chunked.txt"
        
        echo "$MERGED_TRANSCRIPT" > "$TRANSCRIPT_FILE"
        print_success "Transcript saved to: $TRANSCRIPT_FILE"
        
        echo ""
        print_info "📝 Transcript Preview (first 1000 chars):"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "$MERGED_TRANSCRIPT" | head -c 1000
        if [ ${#MERGED_TRANSCRIPT} -gt 1000 ]; then
            echo ""
            echo "... (truncated, see full transcript in file)"
        fi
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        
        print_success "Large file processing complete! 🎉"
        print_info "💡 Note: Analysis failed - check worker logs or OpenAI API key in Cloudflare"
        echo ""
        
        exit 0
    fi
    
    # Analysis completed - jump to results display
    # Skip the single-file upload section
    UPLOAD_TIME=0
    JOB_ID="chunked-$(date +%s)"
    AUDIO_ID="$JOB_ID"
fi

# Only run single-file upload if NOT in splitting mode
if [ "$NEEDS_SPLITTING" != true ]; then

################################################################################
# STEP 1: Upload Audio File (Single File Mode)
################################################################################

print_step "STEP 1: Uploading audio file..."
START_TIME=$(date +%s)

# Create metadata JSON
METADATA=$(jq -n \
    --arg name "$CANDIDATE_NAME" \
    --arg role "$ROLE" \
    '{candidateName: $name, role: $role}')

print_info "Metadata: $METADATA"

# Upload file
UPLOAD_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$WORKER_URL/upload" \
    -F "file=@$AUDIO_FILE" \
    -F "context=$CONTEXT" \
    -F "metadata=$METADATA")

# Extract HTTP status code (last line)
HTTP_STATUS=$(echo "$UPLOAD_RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$UPLOAD_RESPONSE" | sed '$d')

if [ "$HTTP_STATUS" != "201" ]; then
    print_error "Upload failed with status $HTTP_STATUS"
    echo "$RESPONSE_BODY" | jq . 2>/dev/null || echo "$RESPONSE_BODY"
    exit 1
fi

# Parse response
JOB_ID=$(echo "$RESPONSE_BODY" | jq -r '.jobId')
AUDIO_ID=$(echo "$RESPONSE_BODY" | jq -r '.audioId')
EXPIRES_IN=$(echo "$RESPONSE_BODY" | jq -r '.expiresIn')

UPLOAD_TIME=$(($(date +%s) - START_TIME))

print_success "Upload completed in $(format_time $UPLOAD_TIME)"
echo ""
print_result "Job ID:    $JOB_ID"
print_result "Audio ID:  $AUDIO_ID"
print_result "Expires:   $EXPIRES_IN"
echo ""

################################################################################
# STEP 2: Trigger Processing
################################################################################

print_step "STEP 2: Triggering transcription and analysis..."
print_info "This may take 30-60 seconds depending on audio length..."
echo ""

PROCESS_START=$(date +%s)

# Trigger processing (this will take 30-60 seconds)
print_info "Processing started at $(date +%H:%M:%S)..."

# Make the API call with explicit timeout and error handling
HTTP_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST --max-time 120 "$WORKER_URL/process/$JOB_ID")

# Extract HTTP status code (last line)
HTTP_STATUS=$(echo "$HTTP_RESPONSE" | tail -n1)
PROCESS_RESPONSE=$(echo "$HTTP_RESPONSE" | sed '$d')

PROCESS_TIME=$(($(date +%s) - PROCESS_START))

# Check HTTP response
if [ "$HTTP_STATUS" != "200" ]; then
    print_error "Processing API call failed with HTTP $HTTP_STATUS"
    echo "$PROCESS_RESPONSE" | jq . 2>/dev/null || echo "$PROCESS_RESPONSE"
    exit 1
fi

# Validate response is valid JSON
if ! echo "$PROCESS_RESPONSE" | jq . > /dev/null 2>&1; then
    print_error "Invalid JSON response from server"
    echo "$PROCESS_RESPONSE"
    exit 1
fi

# Check if processing succeeded
TRANSCRIPTION_STATUS=$(echo "$PROCESS_RESPONSE" | jq -r '.transcription.status // "unknown"')
ANALYSIS_STATUS=$(echo "$PROCESS_RESPONSE" | jq -r '.analysis.status // "unknown"')

if [ "$TRANSCRIPTION_STATUS" != "completed" ]; then
    print_error "Transcription failed with status: $TRANSCRIPTION_STATUS"
    ERROR_MSG=$(echo "$PROCESS_RESPONSE" | jq -r '.transcription.error // "Unknown error"')
    echo "$ERROR_MSG"
    exit 1
fi

print_success "Processing completed in $(format_time $PROCESS_TIME)"
echo ""

fi  # End of single-file upload section

################################################################################
# STEP 3: Display Results
################################################################################

print_header "ANALYSIS RESULTS"

# Extract all data
TRANSCRIPT=$(echo "$PROCESS_RESPONSE" | jq -r '.transcription.text')
SUMMARY=$(echo "$PROCESS_RESPONSE" | jq -r '.analysis.summary // "N/A"')
SENTIMENT=$(echo "$PROCESS_RESPONSE" | jq -r '.analysis.sentiment // "N/A"')
KEY_TAKEAWAYS=$(echo "$PROCESS_RESPONSE" | jq -r '.analysis.keyTakeaways[]? // empty')
PROS=$(echo "$PROCESS_RESPONSE" | jq -r '.analysis.pros[]? // empty')
CONS=$(echo "$PROCESS_RESPONSE" | jq -r '.analysis.cons[]? // empty')
RECOMMENDATIONS=$(echo "$PROCESS_RESPONSE" | jq -r '.analysis.recommendations[]? // empty')

# Candidate Info
echo -e "${BOLD}${CYAN}👤 CANDIDATE INFORMATION${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${BOLD}Name:${NC} $CANDIDATE_NAME"
echo -e "${BOLD}Role:${NC} $ROLE"
echo -e "${BOLD}Sentiment:${NC} $(echo $SENTIMENT | tr '[:lower:]' '[:upper:]')"
echo ""

# Summary
echo -e "${BOLD}${CYAN}📋 EXECUTIVE SUMMARY${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "$SUMMARY" | fold -s -w 80
echo ""

# Key Takeaways
if [ -n "$KEY_TAKEAWAYS" ]; then
    echo -e "${BOLD}${CYAN}🎯 KEY TAKEAWAYS${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "$KEY_TAKEAWAYS" | while IFS= read -r line; do
        echo "  • $line" | fold -s -w 78 | sed '2,$s/^/    /'
    done
    echo ""
fi

# Strengths
if [ -n "$PROS" ]; then
    echo -e "${BOLD}${GREEN}✓ STRENGTHS${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "$PROS" | while IFS= read -r line; do
        echo "  ✓ $line" | fold -s -w 78 | sed '2,$s/^/    /'
    done
    echo ""
fi

# Areas for Improvement
if [ -n "$CONS" ]; then
    echo -e "${BOLD}${YELLOW}⚠ AREAS FOR IMPROVEMENT${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "$CONS" | while IFS= read -r line; do
        echo "  ⚠ $line" | fold -s -w 78 | sed '2,$s/^/    /'
    done
    echo ""
fi

# Recommendations
if [ -n "$RECOMMENDATIONS" ]; then
    echo -e "${BOLD}${MAGENTA}💡 RECOMMENDATIONS${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "$RECOMMENDATIONS" | while IFS= read -r line; do
        echo "  💡 $line" | fold -s -w 78 | sed '2,$s/^/    /'
    done
    echo ""
fi

# Transcript preview
TRANSCRIPT_LENGTH=${#TRANSCRIPT}
echo -e "${BOLD}${CYAN}📝 TRANSCRIPT${NC} (${TRANSCRIPT_LENGTH} characters)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "$TRANSCRIPT" | head -c 500 | fold -s -w 80
if [ $TRANSCRIPT_LENGTH -gt 500 ]; then
    echo ""
    echo -e "${YELLOW}... (showing first 500 characters, full transcript saved)${NC}"
fi
echo ""

################################################################################
# STEP 4: Save to File
################################################################################

print_step "STEP 4: Saving detailed results..."

# Create output directory
OUTPUT_DIR="results"
mkdir -p "$OUTPUT_DIR"

# Generate filename
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SANITIZED_NAME=$(echo "$CANDIDATE_NAME" | tr ' ' '_' | tr -cd '[:alnum:]_-')
OUTPUT_FILE="$OUTPUT_DIR/${TIMESTAMP}_${SANITIZED_NAME}.json"

# Save full response
echo "$PROCESS_RESPONSE" | jq . > "$OUTPUT_FILE"

print_success "Results saved to: $OUTPUT_FILE"
echo ""

# Save transcript as text file
TRANSCRIPT_FILE="$OUTPUT_DIR/${TIMESTAMP}_${SANITIZED_NAME}_transcript.txt"
echo "$TRANSCRIPT" > "$TRANSCRIPT_FILE"
print_success "Transcript saved to: $TRANSCRIPT_FILE"
echo ""

################################################################################
# Summary
################################################################################

TOTAL_TIME=$(($(date +%s) - START_TIME))

print_header "PIPELINE COMPLETED"

echo -e "${BOLD}Timing Summary:${NC}"
echo "  Upload:        $(format_time $UPLOAD_TIME)"
echo "  Processing:    $(format_time $PROCESS_TIME)"
echo "  Total:         $(format_time $TOTAL_TIME)"
echo ""

echo -e "${BOLD}Output Files:${NC}"
echo "  Full Report:   $OUTPUT_FILE"
echo "  Transcript:    $TRANSCRIPT_FILE"
echo ""

echo -e "${BOLD}Job Reference:${NC}"
echo "  Job ID:        $JOB_ID"
echo "  Status URL:    $WORKER_URL/status/$JOB_ID"
echo ""

print_success "Interview analysis complete! 🎉"
echo ""

