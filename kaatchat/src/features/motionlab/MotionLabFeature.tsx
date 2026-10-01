import { useState, useEffect } from 'react';
import { useMotionLabStore } from './store/motionlabStore';
import { templateRegistry } from './templates/registry';
import Canvas from './components/Canvas';
import ParameterPanel from './components/ParameterPanel';
import MediaUploader from './components/MediaUploader';
import ExportModal from './components/ExportModal';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import { enableAutoSave } from './utils/persistence';
import './MotionLabFeature.css';

/**
 * MOTIONLAB Feature Module
 * Integrated motion design editor within Kaatchat
 * Create animations from static images/videos
 */
export default function MotionLabFeature() {
  const currentProject = useMotionLabStore((s) => s.currentProject);
  const selectTemplate = useMotionLabStore((s) => s.selectTemplate);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [showExport, setShowExport] = useState(false);
  const [showMediaUploader, setShowMediaUploader] = useState(false);

  useEffect(() => {
    if (!currentProject) {
      selectTemplate('floating-card');
    }
  }, []);

  useEffect(() => {
    const cleanup = enableAutoSave(() => currentProject, 3000);
    return cleanup;
  }, [currentProject]);

  const filteredTemplates = selectedCategory === 'all'
    ? templateRegistry
    : templateRegistry.filter((t) => t.category === selectedCategory);

  return (
    <div className="motionlab-feature">
      <TopBar onExport={() => setShowExport(true)} />
      <div className="motionlab-layout">
        <Sidebar
          templates={filteredTemplates}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
        />
        <div className="motionlab-center">
          {!showMediaUploader && currentProject ? (
            <>
              <Canvas
                template={templateRegistry.find((t) => t.id === currentProject.templateId)!}
                project={currentProject}
              />
              <button className="btn-upload-media" onClick={() => setShowMediaUploader(true)}>
                Upload Media
              </button>
            </>
          ) : (
            <MediaUploader />
          )}
        </div>
        {currentProject && (
          <ParameterPanel
            template={templateRegistry.find((t) => t.id === currentProject.templateId)!}
            project={currentProject}
          />
        )}
      </div>
      <ExportModal isOpen={showExport} onClose={() => setShowExport(false)} />
    </div>
  );
}
