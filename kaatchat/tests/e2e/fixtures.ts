// Real media for the end-to-end tests, generated with ffmpeg so the repo
// carries no binaries. Set FFMPEG to override the binary.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(here, '..', 'fixtures', 'generated');
export const ffmpeg = process.env.FFMPEG || 'ffmpeg';

/**
 * talk.webm — 10 s, 1280×720 VP9 + Opus (decodable by open-source Chromium,
 * which lacks H.264/AAC; Chrome and Electron handle both).
 *   audio: silence 0–1 s, tone 1–4 s, silence 4–6 s, tone 6–9 s, silence 9–10 s
 *   video: flat grey with a busy test pattern in the right third
 */
export function ensureFixtures() {
  mkdirSync(FIXTURES, { recursive: true });
  const talk = join(FIXTURES, 'talk.webm');
  if (!existsSync(talk)) {
    execFileSync(
      ffmpeg,
      [
        '-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=0x404040:s=1280x720:r=30:d=10',
        '-f', 'lavfi', '-i', 'testsrc2=s=300x300:r=30:d=10',
        '-f', 'lavfi', '-i', "aevalsrc='if(between(t,1,4)+between(t,6,9),0.5*sin(2*PI*330*t)*(0.6+0.4*sin(2*PI*3*t)),0)':s=48000:d=10",
        '-filter_complex', '[0][1]overlay=x=920:y=210[v]',
        '-map', '[v]', '-map', '2',
        '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-b:v', '800k', '-g', '30', '-deadline', 'realtime', '-cpu-used', '8',
        '-c:a', 'libopus', '-b:a', '96k', '-ac', '2',
        talk,
      ],
      { stdio: 'inherit' },
    );
  }
  const srt = join(FIXTURES, 'talk.srt');
  if (!existsSync(srt)) {
    writeFileSync(
      srt,
      `1\n00:00:01,000 --> 00:00:04,000\nUm today we talk about AI and design.\n\n2\n00:00:06,000 --> 00:00:09,000\nMoney matters when you start a company.\n`,
    );
  }
  return { talk, srt };
}

/** Decode a file fully with ffmpeg and return its duration and stream summary. */
export function probe(file: string): { duration: number; video: string; audio: string } {
  let out = '';
  try {
    execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    throw new Error(`ffmpeg could not decode ${file}: ${(e as { stderr?: Buffer }).stderr?.toString()}`, { cause: e });
  }
  try {
    execFileSync(ffmpeg, ['-hide_banner', '-i', file], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    out = (e as { stderr?: Buffer }).stderr?.toString() ?? ''; // `-i` alone exits non-zero but prints info
  }
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(out);
  const duration = d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : NaN;
  return {
    duration,
    video: /Stream #\S+: Video: ([^\n]+)/.exec(out)?.[1] ?? '',
    audio: /Stream #\S+: Audio: ([^\n]+)/.exec(out)?.[1] ?? '',
  };
}
