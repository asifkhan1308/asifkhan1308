import { beforeEach, describe, expect, it } from 'vitest';
import { useV1 } from '../../src/features/motionlab-v1/store';
import { defaultProject } from '../../src/features/motionlab-v1/engine/defaults';
import { applyAIActions } from '../../src/features/motionlab-v1/engine/aiActions';
import { templateActions } from '../../src/features/motionlab-v1/engine/generate';
import { decodeFeedback, decodeProject, encodeFeedback, encodeProject, LONG_LINK } from '../../src/features/motionlab-v1/engine/share';

const st = () => useV1.getState();
beforeEach(() => st().replaceProject(defaultProject()));

describe('MOTIONLAB V1.5 review links', () => {
  it('round-trips a generated project through a compact, URL-safe link', async () => {
    applyAIActions(templateActions('8 second promo for "Launch Day" "Join us live", blue accents', st().project.composition));
    const p = { ...st().project, comments: [{ id: 'c1', time: 1, text: 'old', author: 'A', createdAt: 1 }] };
    const code = await encodeProject(p);
    expect(code).toMatch(/^1\.[A-Za-z0-9_-]+$/);
    expect(code.length).toBeLessThan(LONG_LINK);
    const back = await decodeProject(code);
    expect(back.layers).toEqual(p.layers);
    expect(back.composition).toEqual(p.composition);
    expect(back.comments).toBeUndefined(); // reviewers start with a clean slate
  });

  it('never puts media bytes or URLs in a link', async () => {
    const p = { ...st().project, assets: [{ id: 'a', kind: 'video' as const, name: 'clip.mp4', mime: 'video/mp4', width: 1280, height: 720, duration: 5, url: 'blob:http://x/123' }] };
    expect((await decodeProject(await encodeProject(p))).assets[0].url).toBe('');
  });

  it('rejects damaged or foreign links with a clear message', async () => {
    const code = await encodeProject(st().project);
    await expect(decodeProject(code.slice(0, code.length / 2))).rejects.toThrow(/incomplete or damaged/);
    await expect(decodeProject('9.abc')).rejects.toThrow(/unknown version/);
    await expect(decodeFeedback(code)).rejects.toThrow(/feedback link/);
  });

  it('round-trips feedback and sanitises what comes back', async () => {
    const code = await encodeFeedback({
      projectId: 'p1',
      projectName: 'Promo',
      comments: [
        { id: 'c1', time: 1.5, text: 'Logo bigger <b>please</b>', author: 'Sam', createdAt: 5 },
        { id: 'c2', time: -3, text: 'x'.repeat(5000), author: '', createdAt: 6 },
        { id: 3, time: 'soon', text: 'bad' } as never,
      ],
    });
    const f = await decodeFeedback(code);
    expect(f.projectId).toBe('p1');
    expect(f.comments).toHaveLength(2);
    expect(f.comments[0]).toMatchObject({ text: 'Logo bigger <b>please</b>', author: 'Sam', time: 1.5 });
    expect(f.comments[1].time).toBe(0);
    expect(f.comments[1].text).toHaveLength(2000);
    expect(f.comments[1].author).toBe('Reviewer');
  });
});
