import { useState } from 'react'
import { Field, TextInput, TextArea, Button, Spinner } from '../adsmanager/ui'

// Draft -> edit -> send. Claude writes the draft; the owner edits it here and
// can ask for a rewrite with a note.
export default function Composer({ draft, setDraft, drafting, onRewrite, showSubject }) {
  const [instructions, setInstructions] = useState('')
  if (drafting && !draft) return <Spinner label="Writing in your voice…" />
  if (!draft) return null
  return (
    <div className="space-y-4">
      {showSubject && (
        <Field label="Subject">
          <TextInput value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} />
        </Field>
      )}
      <Field label="Message" hint="Edit anything. This is exactly what gets sent.">
        <TextArea rows={9} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} />
      </Field>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="Rewrite with a note (optional)">
            <TextInput value={instructions} placeholder="e.g. shorter, mention the budget meeting"
              onChange={e => setInstructions(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !drafting) { e.preventDefault(); onRewrite(instructions) } }} />
          </Field>
        </div>
        <Button variant="secondary" disabled={drafting} onClick={() => onRewrite(instructions)}>
          {drafting ? 'Writing…' : 'Rewrite'}
        </Button>
      </div>
    </div>
  )
}
