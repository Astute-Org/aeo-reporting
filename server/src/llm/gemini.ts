// The Gemini client, constructed once. Developer API key or Vertex AI.

import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';

const HTTP_TIMEOUT_MS = 120_000;

let cached: GoogleGenAI | null | undefined;

export function geminiClient(): GoogleGenAI | null {
  if (cached !== undefined) return cached;
  if (config.geminiAuthMode === 'vertex') {
    // Authenticated via application-default credentials (gcloud auth
    // application-default login, or GOOGLE_APPLICATION_CREDENTIALS).
    cached = config.vertexProjectId
      ? new GoogleGenAI({
          vertexai: true,
          project: config.vertexProjectId,
          location: config.vertexRegion,
          httpOptions: { timeout: HTTP_TIMEOUT_MS },
        })
      : null;
  } else {
    cached = config.geminiApiKey
      ? new GoogleGenAI({ apiKey: config.geminiApiKey, httpOptions: { timeout: HTTP_TIMEOUT_MS } })
      : null;
  }
  return cached;
}

export function geminiConfigured(): boolean {
  return geminiClient() !== null;
}
