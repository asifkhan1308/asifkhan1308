import { importProjectFromText } from './persist';
import type { Project, ReviewComment } from '../types';

/* ──────────────────────────────────────────────────────────────────────────
 * V1.5 review links — no server. The link itself carries the data:
 *   #/review/<code>            read-only player for a project
 *   #/studio/feedback/<code>   the reviewer's timestamped comments, back
 * <code> = "1." + base64url(deflate-raw(JSON)). Imported media bytes never
 * go in a link (far too big); the player shows a placeholder for them.
 * ────────────────────────────────────────────────────────────────────────── */

const VERSION = '1.';
/** Above this many characters some chat apps and email clients cut links. */
export const LONG_LINK = 8000;

async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function inflate(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}
function toB64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function pack(value: unknown): Promise<string> {
  return VERSION + toB64url(await deflate(JSON.stringify(value)));
}
async function unpack(code: string): Promise<string> {
  const c = decodeURIComponent(code.trim());
  if (!c.startsWith(VERSION)) throw new Error('This link was made by a newer or unknown version of MOTIONLAB.');
  try {
    return await inflate(fromB64url(c.slice(VERSION.length)));
  } catch {
    throw new Error('This link is incomplete or damaged — ask for it to be sent again.');
  }
}

/** What goes in a review link: the project minus media bytes/URLs and minus
 *  existing review comments (the reviewer starts clean). */
export function projectForShare(p: Project): Project {
  return {
    ...p,
    assets: p.assets.map((a) => ({ ...a, url: '' })),
    comments: undefined,
  };
}

export async function encodeProject(p: Project): Promise<string> {
  return pack(projectForShare(p));
}
export async function decodeProject(code: string): Promise<Project> {
  return importProjectFromText(await unpack(code));
}

export interface Feedback {
  projectId: string;
  projectName: string;
  comments: ReviewComment[];
}

export async function encodeFeedback(f: Feedback): Promise<string> {
  return pack(f);
}
export async function decodeFeedback(code: string): Promise<Feedback> {
  const f = JSON.parse(await unpack(code)) as Partial<Feedback>;
  if (typeof f.projectId !== 'string' || !Array.isArray(f.comments)) throw new Error('This isn’t a MOTIONLAB feedback link.');
  // Keep only well-formed comments; text is shown as plain text, never HTML.
  const comments = f.comments
    .filter((c): c is ReviewComment => !!c && typeof c.text === 'string' && Number.isFinite(c.time) && typeof c.id === 'string')
    .map((c) => ({
      id: c.id.slice(0, 40),
      time: Math.max(0, c.time),
      text: c.text.slice(0, 2000),
      author: typeof c.author === 'string' && c.author.trim() ? c.author.slice(0, 60) : 'Reviewer',
      createdAt: Number.isFinite(c.createdAt) ? c.createdAt : Date.now(),
    }));
  return { projectId: f.projectId, projectName: typeof f.projectName === 'string' ? f.projectName : '', comments };
}

/** Absolute link for a hash route on this same app. */
export function appLink(hash: string): string {
  return `${location.origin}${location.pathname}${location.search}#${hash}`;
}

/** True when the project uses imported media that a link can't carry. */
export const usesMedia = (p: Project) => p.layers.some((l) => l.type === 'media' || l.type === 'image');
