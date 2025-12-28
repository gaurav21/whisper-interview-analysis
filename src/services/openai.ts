/**
 * OpenAI service for LLM-powered analysis
 */

import type {
  Env,
  ChatMessage,
  OpenAIResponse,
  AnalysisResult,
  ILLMService,
} from "../types";
import { Logger } from "../utils/logger";
import { retryWithBackoff } from "../utils/helpers";

export class OpenAIService implements ILLMService {
  private apiKey: string;
  private logger: Logger;
  private model: string;
  private baseUrl: string;

  constructor(env: Env, logger: Logger, model: string = "gpt-4o-mini") {
    this.apiKey = env.OPENAI_API_KEY;
    this.logger = logger.child({ service: "OpenAIService" });
    this.model = model;
    this.baseUrl = "https://api.openai.com/v1/chat/completions";
  }

  /**
   * Analyzes a candidate interview transcript
   */
  async analyzeInterview(
    transcript: string,
    metadata?: Record<string, unknown>
  ): Promise<AnalysisResult> {
    this.logger.info("Analyzing interview transcript", {
      transcriptLength: transcript.length,
      metadata,
    });

    const systemPrompt = this.getInterviewSystemPrompt();
    const userPrompt = this.getInterviewUserPrompt(transcript, metadata);

    const response = await this.callOpenAI([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    const result = this.parseAnalysisResponse(response);
    this.logger.info("Interview analysis completed", {
      sentiment: result.sentiment,
      confidenceScore: result.confidenceScore,
    });

    return result;
  }

  /**
   * Analyzes a meeting transcript
   */
  async analyzeMeeting(
    transcript: string,
    metadata?: Record<string, unknown>
  ): Promise<AnalysisResult> {
    this.logger.info("Analyzing meeting transcript", {
      transcriptLength: transcript.length,
      metadata,
    });

    const systemPrompt = this.getMeetingSystemPrompt();
    const userPrompt = this.getMeetingUserPrompt(transcript, metadata);

    const response = await this.callOpenAI([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    const result = this.parseAnalysisResponse(response);
    this.logger.info("Meeting analysis completed", {
      sentiment: result.sentiment,
      confidenceScore: result.confidenceScore,
    });

    return result;
  }

  /**
   * Calls OpenAI API with retry logic
   */
  private async callOpenAI(messages: ChatMessage[]): Promise<string> {
    return retryWithBackoff(async () => {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.7,
          max_tokens: 2000,
          response_format: { type: "json_object" },
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        this.logger.error("OpenAI API error", new Error(error), {
          status: response.status,
          statusText: response.statusText,
        });
        throw new Error(`OpenAI API error: ${response.status} - ${error}`);
      }

      const data = (await response.json()) as OpenAIResponse;
      
      if (!data.choices || data.choices.length === 0) {
        throw new Error("No response from OpenAI");
      }

      this.logger.debug("OpenAI API call successful", {
        model: data.model,
        tokensUsed: data.usage.total_tokens,
      });

      return data.choices[0].message.content;
    }, 3, 1000);
  }

  /**
   * Gets system prompt for interview analysis
   */
  private getInterviewSystemPrompt(): string {
    return `You are an expert HR analyst specializing in candidate interview evaluation. 
Your task is to analyze interview transcripts and provide comprehensive, objective assessments.

You must respond with a valid JSON object with the following structure:
{
  "summary": "A concise 2-3 sentence overview of the interview",
  "keyTakeaways": ["List of 3-5 most important points from the interview"],
  "pros": ["List of candidate strengths and positive aspects"],
  "cons": ["List of concerns or areas for improvement"],
  "recommendations": ["List of specific recommendations for hiring decision"],
  "sentiment": "positive|negative|neutral|mixed",
  "confidenceScore": 0.0-1.0
}

Be objective, specific, and provide actionable insights. Focus on:
- Technical skills and knowledge demonstrated
- Communication and presentation skills
- Problem-solving approach
- Cultural fit indicators
- Red flags or concerns
- Overall candidate potential`;
  }

  /**
   * Gets user prompt for interview analysis
   */
  private getInterviewUserPrompt(
    transcript: string,
    metadata?: Record<string, unknown>
  ): string {
    let prompt = "Please analyze this candidate interview transcript:\n\n";

    if (metadata) {
      if (metadata.candidateName) {
        prompt += `Candidate: ${metadata.candidateName}\n`;
      }
      if (metadata.position) {
        prompt += `Position: ${metadata.position}\n`;
      }
      if (metadata.interviewer) {
        prompt += `Interviewer: ${metadata.interviewer}\n`;
      }
      prompt += "\n";
    }

    prompt += `Transcript:\n${transcript}\n\n`;
    prompt +=
      "Provide a comprehensive analysis in the specified JSON format.";

    return prompt;
  }

  /**
   * Gets system prompt for meeting analysis
   */
  private getMeetingSystemPrompt(): string {
    return `You are an expert meeting analyst who helps teams extract maximum value from their discussions.
Your task is to analyze meeting transcripts and provide clear, actionable summaries.

You must respond with a valid JSON object with the following structure:
{
  "summary": "A concise 2-3 sentence overview of the meeting",
  "keyTakeaways": ["List of 3-5 most important points discussed"],
  "pros": ["List of positive outcomes, decisions, or progress made"],
  "cons": ["List of issues, blockers, or concerns raised"],
  "recommendations": ["List of specific action items and next steps"],
  "sentiment": "positive|negative|neutral|mixed",
  "confidenceScore": 0.0-1.0
}

Focus on:
- Main topics discussed
- Decisions made
- Action items
- Concerns or blockers
- Overall meeting productivity`;
  }

  /**
   * Gets user prompt for meeting analysis
   */
  private getMeetingUserPrompt(
    transcript: string,
    metadata?: Record<string, unknown>
  ): string {
    let prompt = "Please analyze this meeting transcript:\n\n";

    if (metadata) {
      if (metadata.date) {
        prompt += `Date: ${metadata.date}\n`;
      }
      if (metadata.participants) {
        prompt += `Participants: ${metadata.participants}\n`;
      }
      prompt += "\n";
    }

    prompt += `Transcript:\n${transcript}\n\n`;
    prompt +=
      "Provide a comprehensive analysis in the specified JSON format.";

    return prompt;
  }

  /**
   * Parses analysis response from OpenAI
   */
  private parseAnalysisResponse(response: string): AnalysisResult {
    try {
      const parsed = JSON.parse(response);

      // Validate required fields
      if (!parsed.summary || !Array.isArray(parsed.keyTakeaways)) {
        throw new Error("Invalid response structure");
      }

      return {
        summary: parsed.summary,
        keyTakeaways: parsed.keyTakeaways || [],
        pros: parsed.pros || [],
        cons: parsed.cons || [],
        recommendations: parsed.recommendations || [],
        sentiment: parsed.sentiment || "neutral",
        confidenceScore: parsed.confidenceScore || 0.5,
      };
    } catch (error) {
      this.logger.error("Failed to parse analysis response", error, {
        response,
      });
      
      // Return a fallback response
      return {
        summary: "Analysis parsing failed. Please review transcript manually.",
        keyTakeaways: ["Unable to extract key takeaways"],
        pros: [],
        cons: [],
        recommendations: ["Manual review recommended"],
        sentiment: "neutral",
        confidenceScore: 0,
      };
    }
  }
}

