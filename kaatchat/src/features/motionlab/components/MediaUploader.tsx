import { useRef } from 'react';
import { useEditorStore } from '../store/editorStore';
import type { MediaAsset } from '../types';

export default function MediaUploader() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addMediaAsset = useEditorStore((s) => s.addMediaAsset);
  const mediaAssets = useEditorStore((s) => s.mediaAssets);
  // const currentProject = useEditorStore((s) => s.currentProject);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const blob = new Blob([event.target?.result as ArrayBuffer], { type: file.type });
      const url = URL.createObjectURL(blob);

      const media = new Image();
      media.onload = () => {
        const asset: MediaAsset = {
          id: Math.random().toString(36).substring(7),
          type: file.type.startsWith('image') ? 'image' : 'video',
          name: file.name,
          data: blob,
          url,
          width: media.width,
          height: media.height,
        };
        addMediaAsset(asset);
      };
      media.src = url;
    };
    reader.readAsArrayBuffer(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('drag-over');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) {
      if (fileInputRef.current) {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInputRef.current.files = dt.files;
        handleFileChange({ target: { files: dt.files } } as any);
      }
    }
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
        >
          <div className="drop-icon">📁</div>
          <div className="drop-text">Drag media here or click to upload</div>
          <div className="drop-hint">PNG, JPG, WEBP, MP4, WEBM</div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
      </div>

      {mediaAssets.length > 0 && (
        <div className="media-library">
          <div className="library-label">Uploaded Media</div>
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
