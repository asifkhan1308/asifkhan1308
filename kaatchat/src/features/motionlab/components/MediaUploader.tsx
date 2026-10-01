import { useRef, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { importFileToMotion } from '../engine/bridge';

export default function MediaUploader() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addMediaAsset = useEditorStore((s) => s.addMediaAsset);
  const mediaAssets = useEditorStore((s) => s.mediaAssets);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ingest = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      // Route through the Kaatchat engine so the media is probed, decoded
      // and persisted in the shared library the Podcast Editor can see too.
      const asset = await importFileToMotion(file);
      addMediaAsset(asset);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not import this file.');
    } finally {
      setBusy(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await ingest(file);
    if (e.target) e.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('drag-over');
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) await ingest(file);
  };

  return (
    <div className="media-uploader">
      <div className="upload-section">
        <div
          className="drop-zone"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          aria-busy={busy}
        >
          <div className="drop-icon">📁</div>
          <div className="drop-text">{busy ? 'Importing…' : 'Drag media here or click to upload'}</div>
          <div className="drop-hint">PNG, JPG, WEBP, MP4, WEBM — shared with Podcast Editor</div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
        {error && <div className="upload-error">{error}</div>}
      </div>

      {mediaAssets.length > 0 && (
        <div className="media-library">
          <div className="library-label">Shared Media</div>
          {mediaAssets.map((asset) => (
            <div key={asset.id} className="media-item">
              <div className="media-thumb">
                {asset.type === 'image' ? (
                  <img src={asset.url} alt={asset.name} />
                ) : (
                  <video src={asset.url} />
                )}
              </div>
              <div className="media-info">
                <div className="media-name">{asset.name}</div>
                <div className="media-dims">
                  {asset.width} × {asset.height}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
