import { useState } from 'react'

import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'

type PendingProps = {
  state: 'pending'
  tool: string
  summary: string
  onDecide: (
    decision: { decision: 'approve' } | { decision: 'reject'; reason?: string }
  ) => void
}

type ResolvedProps = {
  state: 'resolved'
  tool: string
  summary: string
  decision: 'approve' | 'reject'
  reason?: string
}

export type ApprovalCardProps = PendingProps | ResolvedProps

export function ApprovalCard(props: ApprovalCardProps) {
  if (props.state === 'resolved') {
    return <ResolvedRow {...props} />
  }

  return <PendingCard {...props} />
}

function PendingCard({ tool, summary, onDecide }: PendingProps) {
  const [mode, setMode] = useState<'idle' | 'rejecting'>('idle')
  const [reason, setReason] = useState('')
  // Local "I just submitted" flag: keeps the buttons visually locked the moment
  // the user clicks. The card swaps to <ResolvedRow /> once the agent confirms,
  // but until then we don't want clickable Approve/Reject buttons.
  const [submitted, setSubmitted] = useState(false)

  const submitApprove = () => {
    if (submitted) {
      return
    }

    setSubmitted(true)
    onDecide({ decision: 'approve' })
  }

  const submitReject = () => {
    if (submitted) {
      return
    }

    setSubmitted(true)
    onDecide({
      decision: 'reject',
      reason: reason.trim() === '' ? undefined : reason.trim()
    })
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-banana/50 bg-banana/5 px-4 py-3">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[10.5px] font-semibold uppercase tracking-[0.16em] text-banana">
          Approval needed
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {tool}
        </span>
      </div>

      <div className="whitespace-pre-wrap break-words font-mono text-[12.5px] text-foreground">
        {summary}
      </div>

      {mode === 'rejecting' ? (
        <div className="flex flex-col gap-2">
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why reject? (optional — will be sent to the agent)"
            className="min-h-[60px] resize-none text-[13px]"
            disabled={submitted}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={submitted}
              onClick={() => {
                setMode('idle')
                setReason('')
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={submitted}
              onClick={submitReject}
            >
              {submitted ? 'Sending…' : 'Send rejection'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={submitted}
            onClick={submitApprove}
          >
            {submitted ? 'Sending…' : 'Approve'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={submitted}
            onClick={() => setMode('rejecting')}
          >
            Reject
          </Button>
        </div>
      )}
    </div>
  )
}

function ResolvedRow({ tool, summary, decision, reason }: ResolvedProps) {
  const approved = decision === 'approve'

  return (
    <div
      className={cn(
        'flex items-baseline gap-2 rounded-lg border px-3 py-1.5 text-[11.5px]',
        approved
          ? 'border-muted-foreground/20 bg-muted/30 text-muted-foreground'
          : 'border-[color:var(--destructive)]/30 bg-[color:var(--destructive)]/5 text-[color:var(--destructive)]'
      )}
    >
      <span>{approved ? '✓ Approved' : '✗ Rejected'}</span>
      <span className="font-mono text-[11px]">{tool}</span>
      <span className="truncate font-mono text-[11px]">{summary}</span>
      {!approved && reason ? (
        <span className="ml-auto italic">— {reason}</span>
      ) : null}
    </div>
  )
}
