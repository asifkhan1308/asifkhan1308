import { Brand, Icon } from './bits';
import { useAISettings } from '../app/aiState';
import { PROVIDERS } from '../ai/providers';
import { isDesktop } from '../platform/desktop';

export function Privacy() {
  const ai = useAISettings();
  const p = PROVIDERS[ai.active];
  const cloud = p.network === 'internet';
  const rows: [string, string, string][] = [
    ['Video and audio files', 'Stays on this device', 'Decoded, analysed and encoded locally with WebCodecs. Never uploaded — to Kaatchat or to any AI provider.'],
    ['Project and timeline', 'Stays on this device', isDesktop ? 'Saved in the app’s local storage on this computer.' : 'Saved in this browser’s storage (IndexedDB) for this site.'],
    ['Loudness, framing, thumbnails', 'Stays on this device', 'Measured locally from your footage.'],
    ['Transcripts', 'Stays on this device', 'Whisper runs locally. Only the model files are downloaded, once, from Hugging Face.'],
    [
      'AI requests',
      cloud ? `Sent to ${p.name}` : p.network === 'localhost' ? 'Sent to a server on this computer' : 'Stays on this device',
      cloud
        ? 'Your typed request, clip ids and timings, measured loudness and transcript text. Subject to that provider’s own terms and retention policy.'
        : p.network === 'localhost'
          ? 'Your request, timings and transcript text go to the local model server you configured.'
          : 'Built-in commands are fixed rules that run in the app.',
    ],
    ['API keys', isDesktop ? 'OS credential store' : 'This browser', isDesktop ? 'Encrypted by the operating system; the editor page cannot read them; sent only to that provider’s own address.' : 'Stored in this browser for this site; sent only to that provider’s own address. Never sent to Kaatchat.'],
    ['Generated images / video', 'Not in this build', 'No generation providers are connected, so nothing is generated or sent.'],
    ['Analytics and accounts', 'None', 'Kaatchat has no account, no sign-in, no tracking and no telemetry.'],
  ];
  return (
    <div className="page">
      <div className="page-inner">
        <nav className="page-top" aria-label="Main">
          <Brand />
          <span className="spacer" />
          <button className="btn ghost" onClick={() => history.back()}>
            <Icon name="left" /> Back
          </button>
        </nav>
        <h1 style={{ fontSize: 32 }}>Privacy</h1>
        <p className="muted" style={{ marginTop: 10, maxWidth: 680 }}>
          Exactly what stays on this device and what leaves it, with your current settings. AI provider in use: <b>{p.name}</b>.
        </p>
        <table className="table" style={{ marginTop: 20 }}>
          <thead>
            <tr>
              <th>What</th>
              <th>Where it goes</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([what, where, why]) => (
              <tr key={what}>
                <td>{what}</td>
                <td>
                  <span className={`badge ${/Stays|None|OS/.test(where) ? 'ok' : /Not in/.test(where) ? '' : 'warn'}`}>{where}</span>
                </td>
                <td className="muted small">{why}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="faint small" style={{ marginTop: 16 }}>
          Change the AI provider in <a href="#/settings">Settings</a>. Choosing Built-in commands keeps everything on this device.
        </p>
      </div>
    </div>
  );
}
