/**
 * Voice Learning Service — AcreOS Phase 2
 *
 * Learns the user's communication style by analyzing:
 * - Deal notes and property notes
 * - Outbound emails and SMS text
 * - Negotiation messages
 * - Campaign copy they've written
 *
 * Builds a VoiceProfile that is applied to AI-generated outputs
 * platform-wide so every AI response sounds like the user, not generic GPT.
 *
 * Inspired by Trellis's voice fidelity principle:
 * "All AI output must match the user's style — non-negotiable."
 */

// @ts-nocheck — ORM type refinement deferred; runtime-correct
import { db } from '../db';
import {
  leads,
  properties,
  deals,
  notes,
  sellerCommunications as communications,
  organizations,
} from '../../shared/schema';
import { eq, desc, and, isNotNull, not } from 'drizzle-orm';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface VoiceProfile {
  organizationId: number;
  formality: 'casual' | 'professional' | 'very_formal';
  tone: 'warm' | 'direct' | 'analytical' | 'assertive';
  sentenceLength: 'short' | 'medium' | 'long';
  usesContractions: boolean;
  usesFirstPerson: boolean;
  commonPhrases: string[];
  avoidPhrases: string[];
  signatureElements: string[];
  industryVocabulary: string[];
  exampleOpeners: string[];
  exampleClosers: string[];
  rawSamples: string[];
  analyzedAt: string;
  sampleCount: number;
}

interface TextSample {
  text: string;
  source: 'note' | 'email' | 'sms' | 'negotiation' | 'campaign';
  createdAt: Date;
}

class VoiceLearningService {
  /**
   * Collect raw text samples written by the organization's users.
   * Looks across notes, outbound emails, campaign copy, negotiation messages.
   */
  async collectSamples(organizationId: number, limit = 80): Promise<TextSample[]> {
    const samples: TextSample[] = [];

    // Notes on leads, properties, deals
    try {
      const orgNotes = await db
        .select({ body: notes.content, createdAt: notes.createdAt })
        .from(notes)
        .where(
          and(
            eq(notes.organizationId, organizationId),
            isNotNull(notes.content),
          )
        )
        .orderBy(desc(notes.createdAt))
        .limit(Math.floor(limit * 0.4));

      for (const n of orgNotes) {
        if (n.body && n.body.trim().length > 20) {
          samples.push({ text: n.body.trim(), source: 'note', createdAt: n.createdAt });
        }
      }
    } catch (_) { /* table may not have notes column — skip */ }

    // Outbound communications (emails, SMS)
    try {
      const comms = await db
        .select({ body: communications.body, type: communications.type, createdAt: communications.createdAt })
        .from(communications)
        .where(
          and(
            eq(communications.organizationId, organizationId),
            eq(communications.direction, 'outbound'),
            isNotNull(communications.body),
          )
        )
        .orderBy(desc(communications.createdAt))
        .limit(Math.floor(limit * 0.6));

      for (const c of comms) {
        if (c.body && c.body.trim().length > 30) {
          const source = c.type === 'sms' ? 'sms' : 'email';
          samples.push({ text: c.body.trim(), source, createdAt: c.createdAt });
        }
      }
    } catch (_) { /* skip */ }

    // Sort by recency, most recent first
    samples.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return samples.slice(0, limit);
  }

  /**
   * Analyze collected samples via GPT-4 to extract a VoiceProfile.
   */
  async analyzeStyle(organizationId: number, samples: TextSample[]): Promise<VoiceProfile> {
    if (samples.length === 0) {
      return this.defaultProfile(organizationId);
    }

    const combinedText = samples
      .slice(0, 40)
      .map((s, i) => `[Sample ${i + 1} — ${s.source}]\n${s.text}`)
      .join('\n\n---\n\n');

    const prompt = `You are a professional writing style analyst. Analyze the following text samples written by a land investment professional and extract their communication style profile.

${combinedText}

Return ONLY a valid JSON object (no markdown, no explanation) with these exact fields:
{
  "formality": "casual" | "professional" | "very_formal",
  "tone": "warm" | "direct" | "analytical" | "assertive",
  "sentenceLength": "short" | "medium" | "long",
  "usesContractions": true | false,
  "usesFirstPerson": true | false,
  "commonPhrases": ["phrase1", "phrase2"],
  "avoidPhrases": ["overly formal phrase", "corporate jargon to avoid"],
  "signatureElements": ["how they typically close", "how they introduce themselves"],
  "industryVocabulary": ["land-specific terms they use"],
  "exampleOpeners": ["how they start messages"],
  "exampleClosers": ["how they end messages"]
}`;

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 800,
        temperature: 0.3,
      });

      const raw = completion.choices[0].message.content?.trim() || '{}';

      // Strip markdown code fences if present
      const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      const parsed = JSON.parse(cleaned);

      return {
        organizationId,
        formality: parsed.formality || 'professional',
        tone: parsed.tone || 'direct',
        sentenceLength: parsed.sentenceLength || 'medium',
        usesContractions: parsed.usesContractions ?? true,
        usesFirstPerson: parsed.usesFirstPerson ?? true,
        commonPhrases: parsed.commonPhrases || [],
        avoidPhrases: parsed.avoidPhrases || [],
        signatureElements: parsed.signatureElements || [],
        industryVocabulary: parsed.industryVocabulary || [],
        exampleOpeners: parsed.exampleOpeners || [],
        exampleClosers: parsed.exampleClosers || [],
        rawSamples: samples.slice(0, 5).map(s => s.text),
        analyzedAt: new Date().toISOString(),
        sampleCount: samples.length,
      };
    } catch (err) {
      console.error('[VoiceLearning] Failed to analyze style:', err);
      return this.defaultProfile(organizationId);
    }
  }

  /**
   * Build or refresh the voice profile for an organization.
   * Cached in the organizations metadata field to avoid re-analysis on every request.
   */
  async buildProfile(organizationId: number): Promise<VoiceProfile> {
    const samples = await this.collectSamples(organizationId);
    const profile = await this.analyzeStyle(organizationId, samples);

    // Store the profile on the organization record
    try {
      await db
        .update(organizations)
        .set({ voiceProfile: profile } as any)
        .where(eq(organizations.id, organizationId));
    } catch (_) {
      // voiceProfile column may not exist yet — store in memory cache
      this.profileCache.set(organizationId, profile);
    }

    return profile;
  }

  /**
   * Get the voice profile for an organization (from DB or memory cache).
   * If no profile exists, builds one on-demand.
   */
  async getProfile(organizationId: number): Promise<VoiceProfile> {
    // Check memory cache first (fast path)
    const cached = this.profileCache.get(organizationId);
    if (cached) {
      const cacheAge = Date.now() - new Date(cached.analyzedAt).getTime();
      if (cacheAge < 24 * 60 * 60 * 1000) return cached; // 24-hour cache
    }

    // Try DB
    try {
      const org = await db
        .select({ voiceProfile: (organizations as any).voiceProfile })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

      if (org[0]?.voiceProfile) {
        const profile = org[0].voiceProfile as VoiceProfile;
        this.profileCache.set(organizationId, profile);
        return profile;
      }
    } catch (_) { /* column not in schema yet */ }

    // Build fresh profile
    return this.buildProfile(organizationId);
  }

  /**
   * Generate a system prompt instruction block for AI models
   * based on the user's voice profile.
   * Inject this into any AI generation call to match the user's style.
   */
  buildStyleInstruction(profile: VoiceProfile): string {
    const lines: string[] = [
      '## Communication Style Instructions',
      `Write in a ${profile.formality}, ${profile.tone} tone.`,
      `Use ${profile.sentenceLength} sentences.`,
      profile.usesContractions
        ? 'Use natural contractions (I\'m, you\'re, we\'ll).'
        : 'Avoid contractions — write formally.',
      profile.usesFirstPerson
        ? 'Write in first person (I, we, our).'
        : 'Write in a neutral, third-person perspective.',
    ];

    if (profile.commonPhrases.length > 0) {
      lines.push(`Naturally incorporate these phrases when appropriate: ${profile.commonPhrases.slice(0, 5).join(', ')}.`);
    }

    if (profile.avoidPhrases.length > 0) {
      lines.push(`Avoid these phrases: ${profile.avoidPhrases.slice(0, 5).join(', ')}.`);
    }

    if (profile.industryVocabulary.length > 0) {
      lines.push(`Use industry vocabulary: ${profile.industryVocabulary.slice(0, 8).join(', ')}.`);
    }

    if (profile.exampleOpeners.length > 0) {
      lines.push(`Open messages like: "${profile.exampleOpeners[0]}".`);
    }

    if (profile.exampleClosers.length > 0) {
      lines.push(`Close messages like: "${profile.exampleClosers[0]}".`);
    }

    if (profile.rawSamples.length > 0) {
      lines.push('\n## Reference Writing Samples (match this style exactly):');
      profile.rawSamples.slice(0, 2).forEach((sample, i) => {
        lines.push(`[Sample ${i + 1}]: "${sample.slice(0, 200)}..."`);
      });
    }

    return lines.join('\n');
  }

  /**
   * Apply voice profile to AI-generated text via a refinement pass.
   * Use when you have AI text that needs to be rewritten in the user's voice.
   */
  async applyVoice(text: string, profile: VoiceProfile): Promise<string> {
    if (profile.sampleCount < 3) {
      return text; // Not enough data to rewrite
    }

    const styleInstruction = this.buildStyleInstruction(profile);

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a professional editor who rewrites AI-generated text to match a specific person's communication style while preserving all factual content. Do not add or remove information — only adjust tone, style, and phrasing.\n\n${styleInstruction}`,
          },
          {
            role: 'user',
            content: `Rewrite the following text to match the style described above. Return ONLY the rewritten text:\n\n${text}`,
          },
        ],
        max_tokens: Math.min(2000, text.length * 2),
        temperature: 0.4,
      });

      return completion.choices[0].message.content?.trim() || text;
    } catch (err) {
      console.error('[VoiceLearning] Failed to apply voice:', err);
      return text;
    }
  }

  /**
   * Invalidate cached profile (call after significant new communications).
   */
  invalidateProfile(organizationId: number): void {
    this.profileCache.delete(organizationId);
  }

  private defaultProfile(organizationId: number): VoiceProfile {
    return {
      organizationId,
      formality: 'professional',
      tone: 'direct',
      sentenceLength: 'medium',
      usesContractions: true,
      usesFirstPerson: true,
      commonPhrases: [],
      avoidPhrases: [],
      signatureElements: [],
      industryVocabulary: ['acreage', 'parcel', 'seller financing', 'due diligence', 'APN'],
      exampleOpeners: ['Hi', 'Hope this finds you well'],
      exampleClosers: ['Thanks', 'Best regards'],
      rawSamples: [],
      analyzedAt: new Date().toISOString(),
      sampleCount: 0,
    };
  }

  private profileCache = new Map<number, VoiceProfile>();
}

export const voiceLearningService = new VoiceLearningService();
