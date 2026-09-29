import { useEffect, useState } from 'react';
import { Icon, fmtBytes } from './bits';
import { isDesktop } from '../platform/desktop';

interface Release {
  version: string;
  windowsUrl: string | null;
  sha256: string | null;
  size: number | null;
  notes?: string;
  notesUrl?: string;
}

/**
 * Windows download, shown on the web build only — and only when release.json
 * points at a real installer with a checksum. No placeholder buttons.
 */
export function DownloadCard() {
  const [rel, setRel] = useState<Release | null>(null);
  useEffect(() => {
    if (isDesktop) return;
    fetch('./release.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Release | null) => {
        if (j && typeof j.windowsUrl === 'string' && /^https:\/\//.test(j.windowsUrl) && typeof j.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(j.sha256)) setRel(j);
      })
      .catch(() => undefined);
  }, []);
  if (!rel) return null;
  return (
    <section className="card" style={{ padding: 16, marginTop: 16 }} aria-labelledby="dl-h">
      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div className="grow col" style={{ gap: 4 }}>
          <h2 id="dl-h">Kaatchat for Windows</h2>
          <span className="muted small">
            Version {rel.version}
            {rel.size ? ` · ${fmtBytes(rel.size)}` : ''} · Windows 10/11, 64-bit
          </span>
          <span className="faint tiny mono" style={{ wordBreak: 'break-all' }}>
            SHA-256 {rel.sha256}
          </span>
          {rel.notesUrl && (
            <a className="small" href={rel.notesUrl} target="_blank" rel="noreferrer">
              Release notes
            </a>
          )}
        </div>
        <a className="btn primary" href={rel.windowsUrl!} rel="noreferrer">
          <Icon name="download" /> Download for Windows
        </a>
      </div>
      <p className="faint tiny" style={{ marginTop: 8 }}>
        This build is not yet code-signed, so Windows SmartScreen may warn that the publisher is unknown. Check the SHA-256 above
        against the one on the GitHub release before running it.
      </p>
    </section>
  );
}
