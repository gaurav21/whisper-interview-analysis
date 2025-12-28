#!/bin/bash
# Audio Pre-processing Script for Whisper Transcription
# This script helps you prepare large audio files for optimal transcription

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if ffmpeg is installed
if ! command -v ffmpeg &> /dev/null; then
    echo -e "${RED}Error: ffmpeg is not installed.${NC}"
    echo "Install it with:"
    echo "  macOS:   brew install ffmpeg"
    echo "  Ubuntu:  sudo apt-get install ffmpeg"
    echo "  Windows: Download from https://ffmpeg.org/download.html"
    exit 1
fi

# Function to show usage
usage() {
    echo "Usage: $0 <command> <input-file> [output-dir]"
    echo ""
    echo "Commands:"
    echo "  compress    - Compress audio to lower bitrate (optimal for transcription)"
    echo "  split       - Split audio into 5-minute segments"
    echo "  info        - Show audio file information"
    echo ""
    echo "Examples:"
    echo "  $0 compress audio.m4a"
    echo "  $0 split audio.m4a ./segments"
    echo "  $0 info audio.m4a"
    exit 1
}

# Check arguments
if [ $# -lt 2 ]; then
    usage
fi

COMMAND=$1
INPUT_FILE=$2
OUTPUT_DIR=${3:-.}

# Check if input file exists
if [ ! -f "$INPUT_FILE" ]; then
    echo -e "${RED}Error: Input file '$INPUT_FILE' not found.${NC}"
    exit 1
fi

# Get file size
FILE_SIZE=$(du -h "$INPUT_FILE" | cut -f1)

case $COMMAND in
    info)
        echo -e "${GREEN}Audio File Information:${NC}"
        echo "File: $INPUT_FILE"
        echo "Size: $FILE_SIZE"
        echo ""
        ffprobe -v quiet -print_format json -show_format -show_streams "$INPUT_FILE"
        ;;
    
    compress)
        BASENAME=$(basename "$INPUT_FILE" | sed 's/\.[^.]*$//')
        OUTPUT_FILE="${OUTPUT_DIR}/${BASENAME}_compressed.mp3"
        
        echo -e "${YELLOW}Compressing audio for optimal transcription...${NC}"
        echo "Input:  $INPUT_FILE ($FILE_SIZE)"
        echo "Output: $OUTPUT_FILE"
        echo ""
        
        # Compress to 16kHz mono, 32kbps
        # Whisper works best with 16kHz audio
        ffmpeg -i "$INPUT_FILE" \
            -ar 16000 \
            -ac 1 \
            -b:a 32k \
            -map_metadata 0 \
            -y \
            "$OUTPUT_FILE"
        
        NEW_SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)
        echo ""
        echo -e "${GREEN}✓ Compression complete!${NC}"
        echo "Original: $FILE_SIZE"
        echo "Compressed: $NEW_SIZE"
        echo "Saved to: $OUTPUT_FILE"
        ;;
    
    split)
        BASENAME=$(basename "$INPUT_FILE" | sed 's/\.[^.]*$//')
        mkdir -p "$OUTPUT_DIR"
        
        echo -e "${YELLOW}Splitting audio into 5-minute segments...${NC}"
        echo "Input:  $INPUT_FILE ($FILE_SIZE)"
        echo "Output: $OUTPUT_DIR/${BASENAME}_%03d.mp3"
        echo ""
        
        # Split into 5-minute (300 second) segments
        # Convert to MP3 16kHz mono for consistency
        ffmpeg -i "$INPUT_FILE" \
            -f segment \
            -segment_time 300 \
            -ar 16000 \
            -ac 1 \
            -b:a 32k \
            "${OUTPUT_DIR}/${BASENAME}_%03d.mp3"
        
        echo ""
        echo -e "${GREEN}✓ Splitting complete!${NC}"
        echo "Segments created in: $OUTPUT_DIR"
        ls -lh "${OUTPUT_DIR}/${BASENAME}"_*.mp3
        ;;
    
    *)
        echo -e "${RED}Error: Unknown command '$COMMAND'${NC}"
        usage
        ;;
esac

