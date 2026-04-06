import tools from '../config/tools.json'
import ToolButton from './ToolButton'

export default function ToolGrid({ abcUrl }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-5 p-8 max-w-3xl mx-auto w-full">
      {tools.map((tool) => (
        <ToolButton
          key={tool.id}
          label={tool.label}
          description={tool.description}
          icon={tool.icon}
          url={tool.id === 'abc' && abcUrl ? abcUrl : tool.url}
        />
      ))}
    </div>
  )
}
