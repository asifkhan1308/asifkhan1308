import { useEffect, useState } from 'react';
import { t, useLang } from '../../../i18n';
import { useV1 } from '../store';
import { appLink, encodeProject, LONG_LINK, usesMedia } from '../engine/share';

/* V1.5 "Share for review": a link that opens a read-only player where the
 * reviewer leaves timestamped comments and sends them back as a link.
 * Everything travels inside the link — nothing is uploaded anywhere. */
export default function ShareDialog({ onClose }: { onClose: () => void }) {
  useLang();
  const project = useV1((s) => s.project);
  const [link, setLink] = useState('');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    encodeProject(project)
      .then((code) => { if (live) setLink(appLink(`/review/${code}`)); })
      .catch((e) => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [project]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (permissions / insecure context): select it instead.
      (document.querySelector('.v1-share-link') as HTMLTextAreaElement | null)?.select();
    }
  };

  const media = usesMedia(project);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t('studio.share.title')}</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-content">
          <p className="v1-share-lead">
            Anyone with this link can play “{project.name}” and leave comments at exact moments. They send their notes
            back as a link, which shows up as markers on your timeline. Nothing is uploaded — the project lives inside the link.
          </p>
          {err ? (
            <div className="v1-gen-err" role="alert">{err}</div>
          ) : (
            <textarea className="v1-share-link" readOnly rows={3} value={link || t('studio.share.preparing')} onFocus={(e) => e.currentTarget.select()} />
          )}
          {link && (
            <div className="v1-share-meta">
              {(link.length / 1024).toFixed(1)} KB link
              {link.length > LONG_LINK && ' · long: some chat apps cut links this size — email or a doc is safer'}
            </div>
          )}
          {media && (
            <div className="v1-share-warn">
              Imported video and images aren’t included in links (they’re far too big). Reviewers see a placeholder in
              their place; for footage-heavy edits, export an MP4 and share that alongside.
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>{t('studio.close')}</button>
          <button className="btn-primary v1-share-copy" onClick={() => void copy()} disabled={!link}>
            {copied ? t('studio.share.copied') : t('studio.share.copy')}
          </button>
        </div>
      </div>
    </div>
  );
}
