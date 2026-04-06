import tools from '../config/tools.json'
import ToolButton from './ToolButton'

export default function ToolGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6 p-8 max-w-5xl mx-auto">
      {tools.map((tool) => (
        <ToolButton
          key={tool.id}
          label={tool.label}
          icon={tool.icon}
          url={tool.url}
        />
      ))}
    </div>
  )
}
