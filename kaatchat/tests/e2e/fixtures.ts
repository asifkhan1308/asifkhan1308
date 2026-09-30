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
  // Keep the WAV: tests measure where the pauses between sentences really are.
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

/** Pauses of at least `min` seconds in a file's audio, measured by ffmpeg. */
export function silences(file: string, min = 0.15, noiseDb = -40): { start: number; end: number }[] {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-i', file, '-af', `silencedetect=n=${noiseDb}dB:d=${min}`, '-f', 'null', '-'], { encoding: 'utf8' });
  const out: { start: number; end: number }[] = [];
  let start: number | null = null;
  for (const line of (r.stderr ?? '').split('\n')) {
    const s = /silence_start: (-?[\d.]+)/.exec(line);
    if (s) start = Math.max(0, +s[1]);
    const e = /silence_end: ([\d.]+)/.exec(line);
    if (e && start !== null) {
      out.push({ start, end: +e[1] });
      start = null;
    }
  }
  return out;
}

/**
 * street.webm — 1.5 s of traffic-like noise that swells and fades (brown noise,
 * gated every 0.35 s), then real speech (espeak-ng) over the same noise, then
 * 1 s more noise. Null where espeak-ng is not installed.
 */
export function ensureStreetFixture(): { file: string; speechStart: number; speechEnd: number } | null {
  mkdirSync(FIXTURES, { recursive: true });
  const out = join(FIXTURES, 'street.webm');
  const wav = join(FIXTURES, 'street-voice.wav');
  if (!existsSync(wav)) {
    const r = spawnSync('espeak-ng', ['-v', 'en-us', '-s', '140', '-w', wav, 'This is a test of the video editor.']);
    if (r.error || r.status !== 0) return null;
  }
  const speechLen = +(/Duration: \d+:\d+:([\d.]+)/.exec(spawnSync(ffmpeg, ['-hide_banner', '-i', wav], { encoding: 'utf8' }).stderr ?? '')?.[1] ?? 0);
  const total = 1.5 + speechLen + 1;
  if (!existsSync(out))
    execFileSync(ffmpeg, [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc2=s=640x360:r=30:d=${total}`,
      '-i', wav,
      '-f', 'lavfi', '-i', `anoisesrc=color=brown:amplitude=0.5:sample_rate=48000:d=${total}:seed=5`,
      '-filter_complex',
      `[1]aresample=48000,adelay=1500:all=1,apad[v];[2]volume='if(mod(floor(t/0.35),2),1,0.15)':eval=frame[n];[v][n]amix=inputs=2:normalize=0:duration=shortest,aformat=channel_layouts=stereo[a]`,
      '-map', '0:v', '-map', '[a]', '-t', String(total),
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-deadline', 'realtime', '-cpu-used', '8',
      '-c:a', 'libopus', '-b:a', '128k', out,
    ]);
  return { file: out, speechStart: 1.5, speechEnd: 1.5 + speechLen };
}

/**
 * hour.webm — a one-hour recording (small picture, 2 fps) whose audio talks in
 * 2.2 s bursts with 0.8 s pauses, so removing pauses leaves ~1,200 clips; and
 * hour.srt, a matching transcript of 1,200 lines (~9,600 words).
 */
export function ensureHourFixture(): { video: string; srt: string; pauses: number } {
  mkdirSync(FIXTURES, { recursive: true });
  const video = join(FIXTURES, 'hour.webm');
  const srt = join(FIXTURES, 'hour.srt');
  const D = 3600;
  if (!existsSync(video))
    execFileSync(ffmpeg, [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc2=s=160x90:r=2:d=${D}`,
      '-f', 'lavfi', '-i', `aevalsrc='lt(mod(t,3),2.2)*0.4*sin(2*PI*(180+40*sin(2*PI*0.5*t))*t)':s=48000:d=${D}`,
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-b:v', '40k', '-g', '60', '-deadline', 'realtime', '-cpu-used', '8',
      '-c:a', 'libopus', '-b:a', '24k', '-ac', '1', video,
    ]);
  if (!existsSync(srt)) {
    const ts = (s: number) => {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = Math.floor(s % 60);
      const ms = Math.round((s % 1) * 1000);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
    };
    const lines: string[] = [];
    for (let i = 0; i < D / 3; i++) lines.push(`${i + 1}\n${ts(i * 3)} --> ${ts(i * 3 + 2.2)}\nLine ${i + 1} is about topic ${i % 37} and money now.\n`);
    writeFileSync(srt, lines.join('\n'));
  }
  return { video, srt, pauses: D / 3 };
}
