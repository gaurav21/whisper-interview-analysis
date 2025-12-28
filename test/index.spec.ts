import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, vi } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

// Create sample audio data for testing (using small buffer as mock audio)
function createMockAudioBuffer(sizeInBytes: number = 1024): ArrayBuffer {
	const buffer = new ArrayBuffer(sizeInBytes);
	const view = new Uint8Array(buffer);
	// Fill with some data to simulate audio
	for (let i = 0; i < sizeInBytes; i++) {
		view[i] = i % 256;
	}
	return buffer;
}

// Helper to create a mock environment with AI binding
function createMockEnv(mockTranscription = 'This is a test transcription.') {
	return {
		...env,
		AI: {
			run: vi.fn().mockResolvedValue({ text: mockTranscription }),
		},
	};
}

describe('Whisper Transcription Worker', () => {
	describe('GET requests with URL parameter', () => {
		it('returns usage instructions when no URL parameter is provided', async () => {
			const request = new IncomingRequest('http://example.com');
			const ctx = createExecutionContext();
			const mockEnv = createMockEnv();

			const response = await worker.fetch(request, mockEnv, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(400);
			const text = await response.text();
			expect(text).toContain('Usage:');
			expect(text).toContain('GET  ?url=<audio-url>');
			expect(text).toContain('POST with file body');
		});

		it('transcribes audio from a valid URL', async () => {
			const audioBuffer = createMockAudioBuffer(500 * 1024); // 500KB mock audio

			// Mock fetch to return our test audio
			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn().mockResolvedValue(
				new Response(audioBuffer, { status: 200 })
			);

			const request = new IncomingRequest('http://example.com?url=https://example.com/audio.mp3');
			const ctx = createExecutionContext();
			const mockEnv = createMockEnv('Hello from URL transcription');

			const response = await worker.fetch(request, mockEnv, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			const text = await response.text();
			expect(text).toContain('Hello from URL transcription');
			expect(mockEnv.AI.run).toHaveBeenCalled();

			// Restore original fetch
			globalThis.fetch = originalFetch;
		});

		it('handles fetch errors gracefully', async () => {
			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn().mockResolvedValue(
				new Response('Not Found', { status: 404 })
			);

			const request = new IncomingRequest('http://example.com?url=https://example.com/nonexistent.mp3');
			const ctx = createExecutionContext();
			const mockEnv = createMockEnv();

			const response = await worker.fetch(request, mockEnv, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(400);
			const text = await response.text();
			expect(text).toContain('Error fetching audio');
			expect(text).toContain('404');

			globalThis.fetch = originalFetch;
		});
	});

	describe('POST requests with raw binary upload', () => {
		it('transcribes uploaded audio file (raw binary)', async () => {
			const audioBuffer = createMockAudioBuffer(100 * 1024); // 100KB mock audio

			const request = new IncomingRequest('http://example.com', {
				method: 'POST',
				body: audioBuffer,
				headers: {
					'Content-Type': 'application/octet-stream',
				},
			});
			const ctx = createExecutionContext();
			const mockEnv = createMockEnv('Transcribed from raw binary upload');

			const response = await worker.fetch(request, mockEnv, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			const text = await response.text();
			expect(text).toContain('Transcribed from raw binary upload');
			expect(mockEnv.AI.run).toHaveBeenCalled();
		});

		it('returns error for empty request body', async () => {
			const request = new IncomingRequest('http://example.com', {
				method: 'POST',
				body: new ArrayBuffer(0),
				headers: {
					'Content-Type': 'application/octet-stream',
				},
			});
			const ctx = createExecutionContext();
			const mockEnv = createMockEnv();

			const response = await worker.fetch(request, mockEnv, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(400);
			expect(await response.text()).toBe('Empty request body');
		});
	});

	describe('POST requests with multipart form-data', () => {
		it('transcribes uploaded audio file (form-data)', async () => {
			const audioBuffer = createMockAudioBuffer(50 * 1024); // 50KB mock audio
			const file = new File([audioBuffer], 'test-audio.m4a', { type: 'audio/mp4' });

			const formData = new FormData();
			formData.append('file', file);

			const request = new IncomingRequest('http://example.com', {
				method: 'POST',
				body: formData,
			});
			const ctx = createExecutionContext();
			const mockEnv = createMockEnv('Transcribed from form-data upload');

			const response = await worker.fetch(request, mockEnv, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			const text = await response.text();
			expect(text).toContain('Transcribed from form-data upload');
			expect(mockEnv.AI.run).toHaveBeenCalled();
		});

		it('returns error when file is missing from form-data', async () => {
			const formData = new FormData();
			formData.append('other_field', 'some value');

			const request = new IncomingRequest('http://example.com', {
				method: 'POST',
				body: formData,
			});
			const ctx = createExecutionContext();
			const mockEnv = createMockEnv();

			const response = await worker.fetch(request, mockEnv, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(400);
			expect(await response.text()).toBe("Missing 'file' in form data");
		});
	});

	describe('File processing modes', () => {
		it('sends compressed formats as whole file (MP3)', async () => {
			const mp3Buffer = createMockAudioBuffer(2 * 1024 * 1024); // 2MB MP3

			const request = new IncomingRequest('http://example.com', {
				method: 'POST',
				body: mp3Buffer,
				headers: {
					'Content-Type': 'audio/mpeg',
				},
			});
			const ctx = createExecutionContext();
			const mockEnv = createMockEnv('Full MP3 transcription');

			const response = await worker.fetch(request, mockEnv, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			// Should be called once for whole file (compressed format)
			expect(mockEnv.AI.run).toHaveBeenCalledTimes(1);
			expect(response.headers.get('X-Processing-Mode')).toBe('whole-file');
		});

		it('sends compressed formats as whole file (M4A)', async () => {
			const m4aBuffer = createMockAudioBuffer(3 * 1024 * 1024); // 3MB M4A

			const request = new IncomingRequest('http://example.com', {
				method: 'POST',
				body: m4aBuffer,
				headers: {
					'Content-Type': 'audio/mp4',
				},
			});
			const ctx = createExecutionContext();
			const mockEnv = createMockEnv('Full M4A transcription');

			const response = await worker.fetch(request, mockEnv, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			// Should be called once for whole file
			expect(mockEnv.AI.run).toHaveBeenCalledTimes(1);
			expect(response.headers.get('X-Processing-Mode')).toBe('whole-file');
		});

		it('handles small files as a single request', async () => {
			const smallBuffer = createMockAudioBuffer(500 * 1024); // 500KB

			const request = new IncomingRequest('http://example.com', {
				method: 'POST',
				body: smallBuffer,
				headers: {
					'Content-Type': 'application/octet-stream',
				},
			});
			const ctx = createExecutionContext();
			const mockEnv = createMockEnv('Single file transcription');

			const response = await worker.fetch(request, mockEnv, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			// Should be called only once for 500KB
			expect(mockEnv.AI.run).toHaveBeenCalledTimes(1);
		});

		it('includes file size in response headers', async () => {
			const buffer = createMockAudioBuffer(1024 * 100); // 100KB

			const request = new IncomingRequest('http://example.com', {
				method: 'POST',
				body: buffer,
				headers: {
					'Content-Type': 'audio/mpeg',
				},
			});
			const ctx = createExecutionContext();
			const mockEnv = createMockEnv('Test');

			const response = await worker.fetch(request, mockEnv, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.headers.get('X-File-Size')).toBe((1024 * 100).toString());
		});
	});

	describe('Error handling', () => {
		it('rejects files larger than 25MB', async () => {
			// Create a buffer larger than 25MB
			const largeBuffer = createMockAudioBuffer(26 * 1024 * 1024);

			const request = new IncomingRequest('http://example.com', {
				method: 'POST',
				body: largeBuffer,
				headers: {
					'Content-Type': 'audio/mpeg',
				},
			});
			const ctx = createExecutionContext();
			const mockEnv = createMockEnv();

			const response = await worker.fetch(request, mockEnv, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(413);
			const text = await response.text();
			expect(text).toContain('exceeds maximum allowed size');
			expect(text).toContain('25MB');
		});

		it('handles AI transcription errors gracefully', async () => {
			const audioBuffer = createMockAudioBuffer(100 * 1024);

			const request = new IncomingRequest('http://example.com', {
				method: 'POST',
				body: audioBuffer,
				headers: {
					'Content-Type': 'audio/mpeg',
				},
			});
			const ctx = createExecutionContext();
			const mockEnv = {
				...env,
				AI: {
					run: vi.fn().mockRejectedValue(new Error('AI service unavailable')),
				},
			};

			const response = await worker.fetch(request, mockEnv, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(500);
			const text = await response.text();
			expect(text).toContain('Error:');
			expect(text).toContain('AI service unavailable');
		});

		it('provides helpful error messages with FFmpeg instructions', async () => {
			const audioBuffer = createMockAudioBuffer(100 * 1024);

			const request = new IncomingRequest('http://example.com', {
				method: 'POST',
				body: audioBuffer,
				headers: {
					'Content-Type': 'audio/mpeg',
				},
			});
			const ctx = createExecutionContext();
			const mockEnv = {
				...env,
				AI: {
					run: vi.fn().mockRejectedValue(new Error('Invalid audio format')),
				},
			};

			const response = await worker.fetch(request, mockEnv, ctx);
			await waitOnExecutionContext(ctx);

			const text = await response.text();
			expect(text).toContain('ffmpeg');
			expect(text).toContain('Converting to a lower bitrate');
		});
	});

	describe('AI binding calls', () => {
		it('calls AI.run with correct model and base64 encoded audio', async () => {
			const audioBuffer = createMockAudioBuffer(1024);

			const request = new IncomingRequest('http://example.com', {
				method: 'POST',
				body: audioBuffer,
				headers: {
					'Content-Type': 'application/octet-stream',
				},
			});
			const ctx = createExecutionContext();
			const mockEnv = createMockEnv('Test transcription');

			await worker.fetch(request, mockEnv, ctx);
			await waitOnExecutionContext(ctx);

			expect(mockEnv.AI.run).toHaveBeenCalledWith(
				'@cf/openai/whisper-large-v3-turbo',
				expect.objectContaining({
					audio: expect.any(String), // Base64 encoded
				})
			);
		});
	});
});
