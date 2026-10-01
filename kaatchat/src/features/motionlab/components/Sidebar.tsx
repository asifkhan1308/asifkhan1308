import { useEditorStore } from '../store/editorStore';
import type { Template } from '../types';
import { categories } from '../templates/registry';

interface SidebarProps {
  templates: Template[];
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
}

export default function Sidebar({ templates, selectedCategory, onSelectCategory }: SidebarProps) {
  const selectTemplate = useEditorStore((s) => s.selectTemplate);

  return (
    <div className="sidebar">
      <div className="sidebar-header">Templates</div>
      <div className="category-buttons">
        {categories.map((cat) => (
          <button
            key={cat.value}
            className={`category-btn ${selectedCategory === cat.value ? 'active' : ''}`}
            onClick={() => onSelectCategory(cat.value)}
          >
            {cat.label}
          </button>
        ))}
      </div>
      <div className="template-grid">
        {templates.map((template) => (
          <div
            key={template.id}
            className="template-card"
            onClick={() => selectTemplate(template.id)}
          >
            <div className="template-thumbnail" style={{ backgroundImage: `url(${template.thumbnail})` }} />
            <div className="template-name">{template.name}</div>
            <div className="template-category">{template.category}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
