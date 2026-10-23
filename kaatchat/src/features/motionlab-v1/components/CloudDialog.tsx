import { useCallback, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useV1 } from '../store';
import { useCloud } from '../cloud/useCloud';
import { cloudConfig, setCloudConfig, validConfig, type CloudMember, type CloudRow } from '../cloud/backend';

/* V2 Cloud: sign in, save the open project to the cloud, open cloud
 * projects (yours and shared with you), share by email. Media files stay on
 * each device — the cloud holds layers, keyframes and settings. */
export default function CloudDialog({ onClose }: { onClose: () => void }) {
  const c = useCloud(useShallow((s) => ({ configured: s.configured, kind: s.kind, user: s.user, busy: s.busy, error: s.error, link: s.link })));
  const projectName = useV1((s) => s.project.name);
  const [rows, setRows] = useState<CloudRow[]>([]);
  const [members, setMembers] = useState<CloudMember[]>([]);

  const refresh = useCallback(async () => {
    const cl = useCloud.getState();
    if (!cl.user) return;
    setRows(await cl.list());
    setMembers(cl.link?.role === 'owner' ? await cl.members() : []);
  }, []);

  useEffect(() => { void useCloud.getState().init(); }, []);
  useEffect(() => { void refresh(); }, [c.user, c.link?.cloudId, c.link?.updatedAt, refresh]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal v1-cloud" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Cloud">
        <div className="modal-header">
          <h2>Cloud</h2>
          <button className="btn-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-content">
          {c.error && <div className="v1-gen-err" role="alert">{c.error}</div>}
          {!c.configured ? <Setup /> : !c.user ? <SignIn kind={c.kind} /> : (
            <>
              <div className="v1-cloud-who">
                <span>Signed in as <b>{c.user.email}</b>{c.kind === 'memory' && <span className="v1-cloud-badge">demo · this browser only</span>}</span>
                <button type="button" className="btn-ghost" onClick={() => void useCloud.getState().signOut()}>Sign out</button>
              </div>

              <section className="v1-cloud-section" aria-label="This project">
                <h3>This project · {projectName}</h3>
                <p className="v1-cloud-note">
                  {!c.link ? 'Only on this device.'
                    : c.link.role === 'viewer' ? 'Shared with you to view — you can open it, not save it.'
                    : `In the cloud · last saved ${new Date(c.link.updatedAt).toLocaleString()}.`}
                </p>
                {c.link?.role !== 'viewer' && (
                  <button type="button" className="btn-primary" disabled={c.busy} onClick={() => void useCloud.getState().save()}>
                    {c.link ? 'Save to cloud now' : 'Save to cloud'}
                  </button>
                )}
                {c.link?.role === 'owner' && <Share members={members} onChange={refresh} />}
              </section>

              <section className="v1-cloud-section" aria-label="Cloud projects">
                <h3>Cloud projects</h3>
                {rows.length === 0 ? <p className="v1-cloud-note">Nothing yet. Projects you save, or that people share with you, show up here.</p> : (
                  <ul className="v1-cloud-list">
                    {rows.map((r) => (
                      <li key={r.id} className={c.link?.cloudId === r.id ? 'current' : ''}>
                        <div className="v1-cloud-row-main">
                          <b>{r.name}</b>
                          <span className="v1-cloud-note">
                            {r.owner ? 'Yours' : `Shared by ${r.ownerEmail} · ${r.role}`} · saved {new Date(r.updatedAt).toLocaleString()} by {r.updatedBy}
                          </span>
                        </div>
                        <button type="button" className="btn-ghost" disabled={c.busy} onClick={async () => { if (await useCloud.getState().open(r.id)) onClose(); }}>Open</button>
                        {r.owner && (
                          <button type="button" className="btn-ghost" disabled={c.busy}
                            onClick={async () => { if (confirm(`Delete “${r.name}” from the cloud for everyone? Copies on devices stay.`) && await useCloud.getState().remove(r.id)) void refresh(); }}>
                            Delete
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <p className="v1-cloud-note">Imported video, audio and images stay on each device; a collaborator sees a placeholder until they add the same file.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SignIn({ kind }: { kind: string | null }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const busy = useCloud((s) => s.busy);
  return (
    <form className="v1-cloud-section" onSubmit={async (e) => {
      e.preventDefault();
      const r = await useCloud.getState().signInWithEmail(email);
      if (r === 'link-sent') setSent(true);
    }}>
      <h3>Sign in to save projects to the cloud and work together</h3>
      {sent ? (
        <p className="v1-cloud-note" role="status">Check {email} — click the link in the email to finish signing in. You can close this tab’s dialog meanwhile.</p>
      ) : (
        <>
          <input className="text-input" type="email" required placeholder="you@example.com" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" className="btn-primary" disabled={busy}>{kind === 'memory' ? 'Sign in' : 'Email me a sign-in link'}</button>
          {kind !== 'memory' && (
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => void useCloud.getState().signInWithGoogle()}>Continue with Google</button>
          )}
        </>
      )}
      <ResetLink />
    </form>
  );
}

function Share({ members, onChange }: { members: CloudMember[]; onChange: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<CloudMember['role']>('editor');
  const busy = useCloud((s) => s.busy);
  return (
    <div className="v1-cloud-share">
      <form onSubmit={async (e) => {
        e.preventDefault();
        if (await useCloud.getState().share(email, role)) { setEmail(''); onChange(); }
      }}>
        <input className="text-input" type="email" required placeholder="collaborator@example.com" aria-label="Share with email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select aria-label="Access" value={role} onChange={(e) => setRole(e.target.value as CloudMember['role'])}>
          <option value="editor">Can edit</option>
          <option value="viewer">Can view</option>
        </select>
        <button type="submit" className="btn-ghost" disabled={busy}>Share</button>
      </form>
      {members.length > 0 && (
        <ul className="v1-cloud-members" aria-label="People with access">
          {members.map((m) => (
            <li key={m.email}>
              <span>{m.email} · {m.role === 'editor' ? 'can edit' : 'can view'}</span>
              <button type="button" className="btn-ghost" aria-label={`Remove ${m.email}`} disabled={busy}
                onClick={async () => { if (await useCloud.getState().unshare(m.email)) onChange(); }}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <p className="v1-cloud-note">They sign in with that email and find it under Cloud projects. Saves show up for everyone live.</p>
    </div>
  );
}

function Setup() {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const connect = (cfg: { url: string; key: string }) => {
    const bad = validConfig(cfg);
    if (bad) { setErr(bad); return; }
    setCloudConfig(cfg);
    void useCloud.getState().init();
  };
  return (
    <form className="v1-cloud-section" onSubmit={(e) => { e.preventDefault(); connect({ url: url.trim(), key: key.trim() }); }}>
      <h3>Connect Studio Cloud</h3>
      <p className="v1-cloud-note">
        Studio Cloud runs on a free Supabase project. Paste its Project URL and publishable key (Supabase → Project Settings → API).
        See docs/CLOUD.md for the one-time setup.
      </p>
      {err && <div className="v1-gen-err" role="alert">{err}</div>}
      <input className="text-input" placeholder="https://xxxx.supabase.co" aria-label="Project URL" value={url} onChange={(e) => setUrl(e.target.value)} />
      <input className="text-input" placeholder="sb_publishable_… or anon key" aria-label="Publishable key" value={key} onChange={(e) => setKey(e.target.value)} />
      <button type="submit" className="btn-primary">Connect</button>
      <button type="button" className="btn-ghost" onClick={() => connect({ url: 'memory:', key: '' })}>Try the demo (this browser only)</button>
    </form>
  );
}

function ResetLink() {
  if (!cloudConfig()) return null;
  return (
    <button type="button" className="btn-link v1-cloud-reset" onClick={() => { setCloudConfig(null); void useCloud.getState().init(); }}>
      Change cloud connection
    </button>
  );
}
