import { useEditorStore } from '../store/editorStore';
import type { Template, Project } from '../types';

interface ParameterPanelProps {
  template: Template;
  project: Project;
}

export default function ParameterPanel({ template, project }: ParameterPanelProps) {
  const updateParameter = useEditorStore((s) => s.updateParameter);
  const setAnimation = useEditorStore((s) => s.setAnimation);

  return (
    <div className="parameter-panel">
      <div className="panel-header">{template.name}</div>
      <div className="parameters">
        {template.parameters.map((param) => (
          <div key={param.id} className="parameter">
            <label className="param-label">{param.label}</label>
            {param.type === 'slider' && (
              <div className="param-slider">
                <input
                  type="range"
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  value={Number(project.parameters[param.id] ?? param.default)}
                  onChange={(e) => updateParameter(param.id, parseFloat(e.target.value))}
                  className="slider"
                />
                <span className="param-value">
                  {String(project.parameters[param.id] ?? param.default)}
                  {param.unit}
                </span>
              </div>
            )}
            {param.type === 'color' && (
              <input
                type="color"
                value={String(project.parameters[param.id] ?? param.default)}
                onChange={(e) => updateParameter(param.id, e.target.value)}
                className="color-input"
              />
            )}
          </div>
        ))}
        <div className="parameter">
          <label className="param-label">Duration</label>
          <div className="param-slider">
            <input
              type="range"
              min="1"
              max="15"
              step="0.1"
              value={project.animation.duration}
              onChange={(e) => setAnimation({ duration: parseFloat(e.target.value) })}
              className="slider"
            />
            <span className="param-value">{project.animation.duration.toFixed(1)}s</span>
          </div>
        </div>
      </div>
    </div>
  );
}
