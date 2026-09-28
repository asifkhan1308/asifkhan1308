// The only way anything — a button, a shortcut, or an AI model — changes the
// timeline. Commands are plain JSON, validated here before they touch the
// editor. An AI model can propose commands; it can never run code.

import { z } from 'zod';

const seconds = z.number().finite().min(0).max(60 * 60 * 12);
const id = z.string().min(1).max(64);
const range = z
  .object({ start: seconds, end: seconds })
  .strict()
  .refine((r) => r.end > r.start, { message: 'end must be after start' });

export const AspectSchema = z.enum(['16:9', '9:16', '1:1', '4:5']);
export const SilencePresetSchema = z.enum(['natural', 'balanced', 'aggressive']);
export const CaptionStyleSchema = z.enum(['minimal', 'bold', 'podcast', 'kinetic', 'clean']);

export const CommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('split_clip'), at: seconds }).strict(),
  z.object({ type: z.literal('trim_clip'), clipId: id, in: seconds.optional(), out: seconds.optional() }).strict(),
  z.object({ type: z.literal('delete_clip'), clipId: id }).strict(),
  z.object({ type: z.literal('move_clip'), clipId: id, toIndex: z.number().int().min(0).max(10000) }).strict(),
  z.object({ type: z.literal('remove_ranges'), ranges: z.array(range).min(1).max(500) }).strict(),
  z.object({ type: z.literal('keep_ranges'), ranges: z.array(range).min(1).max(200) }).strict(),
  z.object({ type: z.literal('prepend_range'), start: seconds, end: seconds, removeOriginal: z.boolean().default(false) }).strict(),
  z.object({ type: z.literal('remove_silence'), preset: SilencePresetSchema.default('balanced') }).strict(),
  z.object({ type: z.literal('smart_cuts'), preset: SilencePresetSchema.default('balanced') }).strict(),
  z.object({ type: z.literal('match_levels'), targetDb: z.number().min(-40).max(-6).default(-18) }).strict(),
  z.object({ type: z.literal('set_aspect'), aspect: AspectSchema }).strict(),
  z.object({ type: z.literal('reframe'), mode: z.enum(['content', 'center', 'fit']).default('content') }).strict(),
  z.object({ type: z.literal('remove_fillers') }).strict(),
  z
    .object({ type: z.literal('remove_words'), assetId: id, ranges: z.array(range).min(1).max(2000) })
    .strict(),
  z
    .object({
      type: z.literal('set_captions'),
      enabled: z.boolean(),
      style: CaptionStyleSchema.optional(),
      maxWords: z.number().int().min(1).max(12).optional(),
    })
    .strict(),
  z.object({ type: z.literal('set_clip_gain'), clipId: id, gainDb: z.number().min(-40).max(24) }).strict(),
  z
    .object({
      type: z.literal('select_highlights'),
      targetDuration: z.number().min(3).max(60 * 30),
    })
    .strict(),
  z.object({ type: z.literal('rename_project'), name: z.string().min(1).max(120) }).strict(),
]);

export type Command = z.infer<typeof CommandSchema>;
export type CommandInput = z.input<typeof CommandSchema>;
export type CommandType = Command['type'];

export const EditPlanSchema = z
  .object({
    summary: z.string().max(600),
    commands: z.array(CommandSchema).max(40),
  })
  .strict();

export type EditPlan = z.infer<typeof EditPlanSchema>;

/** Human-readable catalogue, also sent to AI providers as the contract. */
export const COMMAND_DOCS: Record<CommandType, string> = {
  split_clip: '{"type":"split_clip","at":<timeline seconds>} — split whatever is under that time',
  trim_clip: '{"type":"trim_clip","clipId":"…","in"?:<source s>,"out"?:<source s>}',
  delete_clip: '{"type":"delete_clip","clipId":"…"} — ripple delete a clip',
  move_clip: '{"type":"move_clip","clipId":"…","toIndex":<0-based>}',
  remove_ranges: '{"type":"remove_ranges","ranges":[{"start":s,"end":s}]} — cut TIMELINE ranges out (ripple)',
  keep_ranges:
    '{"type":"keep_ranges","ranges":[{"start":s,"end":s}]} — keep only these TIMELINE ranges, in time order',
  prepend_range:
    '{"type":"prepend_range","start":s,"end":s,"removeOriginal":false} — copy (or move) a TIMELINE range to the very start, e.g. as a hook',
  remove_silence: '{"type":"remove_silence","preset":"natural"|"balanced"|"aggressive"} — cut measured quiet stretches',
  smart_cuts: '{"type":"smart_cuts","preset":…} — trim dead air from the head and tail of every clip',
  match_levels: '{"type":"match_levels","targetDb":-18} — bring every clip to the same measured loudness',
  set_aspect: '{"type":"set_aspect","aspect":"16:9"|"9:16"|"1:1"|"4:5"}',
  reframe:
    '{"type":"reframe","mode":"content"|"center"|"fit"} — content = crop around the busiest region (measured), not face tracking',
  remove_fillers: '{"type":"remove_fillers"} — cut um/uh/erm/hmm words (needs a transcript)',
  remove_words:
    '{"type":"remove_words","assetId":"…","ranges":[{"start":s,"end":s}]} — cut SOURCE ranges of one asset (transcript editing)',
  set_captions: '{"type":"set_captions","enabled":true,"style"?:"minimal"|"bold"|"podcast"|"kinetic"|"clean"}',
  set_clip_gain: '{"type":"set_clip_gain","clipId":"…","gainDb":<-40..24>}',
  select_highlights:
    '{"type":"select_highlights","targetDuration":<s>} — keep the most energetic moments (measured loudness) up to that length',
  rename_project: '{"type":"rename_project","name":"…"}',
};

export interface ValidationResult {
  ok: boolean;
  plan?: EditPlan;
  errors: string[];
}

/** Validate untrusted JSON (e.g. a model's reply) as an EditPlan. */
export function validatePlan(input: unknown): ValidationResult {
  const r = EditPlanSchema.safeParse(input);
  if (r.success) return { ok: true, plan: r.data, errors: [] };
  return {
    ok: false,
    errors: r.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}

/**
 * Pull the first JSON object out of a model reply. Models sometimes wrap
 * JSON in prose or code fences; we accept that, but nothing else.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const body = fence ? fence[1] : trimmed;
  const start = body.indexOf('{');
  if (start < 0) throw new Error('The reply contained no JSON object.');
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return JSON.parse(body.slice(start, i + 1));
  }
  throw new Error('The reply contained an unterminated JSON object.');
}
