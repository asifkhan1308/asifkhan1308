# MOTIONLAB Integration Guide

MOTIONLAB is now integrated into Kaatchat as a complete feature module. Here's how to add it to your main navigation:

## Step 1: Add Navigation Tab

In your main App or Layout component, add a tab for MOTIONLAB:

```tsx
import { MotionLabFeature } from './features/motionlab';

export default function App() {
  const [activeTab, setActiveTab] = useState('editor'); // or 'motionlab'

  return (
    <div>
      <nav className="tabs">
        <button 
          className={activeTab === 'editor' ? 'active' : ''} 
          onClick={() => setActiveTab('editor')}
        >
          Podcast Editor
        </button>
        <button 
          className={activeTab === 'motionlab' ? 'active' : ''} 
          onClick={() => setActiveTab('motionlab')}
        >
          Motion Design
        </button>
      </nav>

      <div className="content">
        {activeTab === 'editor' && <YourMainEditor />}
        {activeTab === 'motionlab' && <MotionLabFeature />}
      </div>
    </div>
  );
}
```

## Step 2: Update Styles (Optional)

The MOTIONLAB feature uses its own CSS (`MotionLabFeature.css`), but you may want to ensure consistent spacing:

```css
.tabs {
  display: flex;
  border-bottom: 1px solid #2a2a2a;
  background: #0f0f0f;
}

.tabs button {
  padding: 12px 20px;
  background: none;
  border: none;
  color: #999;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
}

.tabs button.active {
  color: #e0e0e0;
  border-bottom-color: #2a6a8a;
}
```

## Step 3: Share State (Optional)

If you want to share media between Kaatchat and MOTIONLAB:

```tsx
import { useMotionLabStore } from './features/motionlab';

// In your main editor:
const { mediaAssets, addMediaAsset } = useMotionLabStore();

// When user uploads media, add it to MOTIONLAB too:
const handleMediaUpload = (file) => {
  // ... your existing logic
  
  // Also add to MOTIONLAB for later motion design work
  addMediaAsset({
    id: generateId(),
    type: file.type.startsWith('image') ? 'image' : 'video',
    name: file.name,
    data: blob,
    url: objectURL,
    width: dimensions.width,
    height: dimensions.height,
  });
};
```

## Features Available

**MOTIONLAB provides:**
- 25+ animation templates
- Media upload (drag-and-drop)
- Real-time animation preview
- Parameter customization
- Timeline scrubbing
- Playback controls
- Project auto-save (IndexedDB)
- Export to MP4/WebM
- Undo/redo history

**Kaatchat remains:**
- Video editing for podcasts/talking-heads
- Whisper transcription
- RNNoise voice isolation
- Brand Kit
- Audio tracks & effects
- Export/publishing

## Architecture

```
Kaatchat (Main App)
├── Podcast Editor (existing)
├── MOTIONLAB Feature Module (new)
│   ├── Templates (25+ animations)
│   ├── Components (UI for motion design)
│   ├── Store (Zustand state)
│   └── Utils (persistence, rendering)
└── Shared Navigation
```

## Deployment

- Build: `npm run build` (includes MOTIONLAB)
- Desktop: Electron app has MOTIONLAB as a tab
- Web: Both features accessible in same session

## Next Steps

1. Import `MotionLabFeature` where you want it
2. Add navigation tab to show/hide it
3. (Optional) Share media state between features
4. Deploy as unified video creation platform

---

**MOTIONLAB + Kaatchat = Complete Video Creation Suite**
