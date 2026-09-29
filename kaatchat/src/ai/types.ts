// Provider abstraction. Kaatchat never depends on one AI company: every
// provider implements the same small interface, and the editor only ever
// receives validated edit plans, never code.

import type { EditPlan } from '../engine/commands/schema';

export type ProviderId = 'builtin' | 'local' | 'openai' | 'gemini' | 'claude';

export type Capability =
  | 'text'
  | 'edit-plan'
  | 'footage-search'
  | 'metadata'
  // Declared for future adapters; nothing in this build claims them.
  | 'image-generation'
  | 'video-generation'
  | 'audio-generation';

export interface ProviderSettings {
  enabled: boolean;
  model: string;
  /** Only used by the local provider (e.g. an Ollama server). */
  baseUrl?: string;
}

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  /** Does using it send anything off this device? */
  network: 'none' | 'localhost' | 'internet';
  needsKey: boolean;
  defaultModel: string;
  capabilities: Capability[];
  privacy: string;
  keyHelp?: string;
}

export interface ChatRequest {
  system: string;
  user: string;
  /** Ask for a JSON object back. */
  json: boolean;
  signal?: AbortSignal;
  maxTokens?: number;
}

export interface AIProvider {
  readonly info: ProviderInfo;
  generateText(req: ChatRequest): Promise<string>;
  /** Quick authenticated round trip, for the settings screen. */
  testConnection(signal?: AbortSignal): Promise<string>;
}

/** Errors a person can act on. `kind` drives the UI message. */
export class AIError extends Error {
  constructor(
    message: string,
    readonly kind: 'no-key' | 'auth' | 'rate-limit' | 'network' | 'offline' | 'bad-output' | 'refused' | 'server' | 'cancelled',
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// What is sent to a provider: metadata only, never media.
// ---------------------------------------------------------------------------

export interface FootageContext {
  project: { name: string; aspect: string; duration: number };
  clips: {
    id: string;
    assetId: string;
    timelineStart: number;
    timelineEnd: number;
    sourceIn: number;
    sourceOut: number;
    media: string;
    levelDb: number | null;
  }[];
  /** Transcript sentences mapped to TIMELINE time. */
  transcript: { start: number; end: number; text: string }[];
  playhead: number;
}

export interface PlanResult {
  plan: EditPlan;
  providerId: ProviderId;
  model: string;
  raw?: string;
}

export interface Moment {
  start: number; // timeline seconds
  end: number;
  title: string;
  why: string;
}
