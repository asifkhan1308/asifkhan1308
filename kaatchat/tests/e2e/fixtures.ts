// Real media for the end-to-end tests, generated with ffmpeg so the repo
// carries no binaries. Set FFMPEG to override the binary.

import { execFileSync, spawnSync } from 'node:child_process';
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
  // music.ogg — 12 s, 120 bpm clicks over a soft pad (Opus).
  const music = join(FIXTURES, 'music.ogg');
  if (!existsSync(music)) {
    execFileSync(ffmpeg, [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', "aevalsrc='0.9*sin(2*PI*1200*t)*exp(-mod(t-0.1,0.5)*60)*gte(t,0.1)+0.05*sin(2*PI*220*t)':s=48000:d=12",
      '-c:a', 'libopus', '-b:a', '96k', '-ac', '2', music,
    ]);
  }
  // vertical.webm — 4 s, 720×1280 phone footage (VP9 + Opus).
  const vertical = join(FIXTURES, 'vertical.webm');
  if (!existsSync(vertical)) {
    execFileSync(ffmpeg, [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=30:d=4',
      '-f', 'lavfi', '-i', 'sine=f=440:sample_rate=48000:d=4',
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-b:v', '600k', '-deadline', 'realtime', '-cpu-used', '8',
      '-c:a', 'libopus', '-b:a', '64k', '-ac', '2', vertical,
    ]);
  }
  // silent.webm — 2 s of video with no audio track at all.
  const silent = join(FIXTURES, 'silent.webm');
  if (!existsSync(silent))
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=2', '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-deadline', 'realtime', '-cpu-used', '8', silent]);
  // noisy.webm — 6 s of 640×360 video; steady hiss throughout (-35 dBFS) and a
  // "voice" (220 Hz + 660 Hz) from 2 s to 4 s.
  const noisy = join(FIXTURES, 'noisy.webm');
  if (!existsSync(noisy))
    execFileSync(ffmpeg, [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=6',
      '-f', 'lavfi', '-i', "aevalsrc='between(t,2,4)*(0.25*sin(2*PI*220*t)+0.12*sin(2*PI*660*t))':s=48000:d=6",
      '-f', 'lavfi', '-i', 'anoisesrc=color=white:amplitude=0.03:sample_rate=48000:d=6:seed=7',
      '-filter_complex', '[1][2]amix=inputs=2:normalize=0,aformat=channel_layouts=stereo[a]',
      '-map', '0:v', '-map', '[a]',
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-deadline', 'realtime', '-cpu-used', '8',
      '-c:a', 'libopus', '-b:a', '128k', noisy,
    ]);
  const logo = join(FIXTURES, 'logo.png');
  if (!existsSync(logo)) execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=256x256,drawbox=x=48:y=48:w=160:h=160:color=black:t=fill', '-frames:v', '1', logo]);
  const srt = join(FIXTURES, 'talk.srt');
  if (!existsSync(srt)) {
    writeFileSync(
      srt,
      `1\n00:00:01,000 --> 00:00:04,000\nUm today we talk about AI and design.\n\n2\n00:00:06,000 --> 00:00:09,000\nMoney matters when you start a company.\n`,
    );
  }
  return { talk, srt, music, logo, vertical, silent, noisy };
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

/** Mean level (dBFS) of [start, start + dur) seconds of a file's audio, measured by ffmpeg. */
export function meanVolume(file: string, start: number, dur: number): number {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-ss', String(start), '-t', String(dur), '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /mean_volume: (-?[\d.]+) dB/.exec(r.stderr ?? '');
  if (!m) throw new Error(`ffmpeg could not measure ${file}: ${r.stderr}`);
  return +m[1];
}

/**
 * speech.webm — real synthesized English speech (espeak-ng), for testing Whisper
 * end to end. Returns null where espeak-ng is not installed.
 */
export function ensureSpeechFixture(): string | null {
  mkdirSync(FIXTURES, { recursive: true });
  const out = join(FIXTURES, 'speech.webm');
  if (existsSync(out)) return out;
  const wav = join(FIXTURES, 'speech.wav');
  const r = spawnSync('espeak-ng', ['-v', 'en-us', '-s', '140', '-w', wav, 'Hello world. This is a test of the video editor. Money matters when you start a company.']);
  if (r.error || r.status !== 0) return null;
  execFileSync(ffmpeg, [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=0x303030:s=640x360:r=30',
    '-i', wav,
    '-shortest',
    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-deadline', 'realtime', '-cpu-used', '8',
    '-c:a', 'libopus', '-b:a', '64k', '-ar', '48000', out,
  ]);
  return out;
}
