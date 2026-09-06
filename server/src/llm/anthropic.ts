// The Anthropic client, constructed once.

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

let cached: Anthropic | null = null;

export function anthropicConfigured(): boolean {
  return Boolean(config.anthropicApiKey);
}

export function anthropicClient(): Anthropic {
  if (!cached) cached = new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 2 });
  return cached;
}
