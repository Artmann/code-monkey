import dayjs from 'dayjs'
import { motion } from 'framer-motion'
import { Check, Copy } from 'lucide-react'
import { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { cn } from '../lib/utils'

interface AgentMessageCardProps {
  text: string
  timestamp?: string | null
  streaming?: boolean
  className?: string
  // When false, skip the fade-in transition. Used to avoid replaying every
  // already-present message animation when a transcript first paints.
  animateIn?: boolean
}

// Re-render only when the markdown text actually changes, not on every parent
// re-render. remark-gfm parsing is non-trivial; this matters for transcripts
// with many messages.
export const MarkdownBody = memo(function MarkdownBody({
  text
}: {
  text: string
}) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
})

function formatTime(value?: string | null): string | null {
  if (!value) {
    return null
  }

  const date = dayjs(value)

  if (!date.isValid()) {
    return value
  }

  return date.format('HH:mm:ss')
}

export function AgentMessageCard({
  text,
  timestamp,
  streaming = false,
  className,
  animateIn = true
}: AgentMessageCardProps) {
  const [copied, setCopied] = useState(false)

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  const time = formatTime(timestamp)

  return (
    <motion.div
      initial={animateIn ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' as const }}
      className={cn('group flex flex-col', className)}
    >
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-[11.5px] font-medium text-[color:var(--fg-3)]">
          agent
        </span>
        {time ? (
          <span className="font-mono text-[10.5px] text-[color:var(--fg-4)]">
            {time}
          </span>
        ) : null}
      </div>

      <div className="prose prose-sm prose-agent max-w-prose text-[13.5px] leading-[1.55] text-[color:var(--fg)] dark:prose-invert">
        <MarkdownBody text={text} />
        {streaming ? (
          <span
            aria-hidden="true"
            className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-cursor-blink bg-[color:var(--fg-2)] align-middle"
          />
        ) : null}
      </div>

      <div className="mt-1 flex gap-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-[color:var(--fg-3)] hover:bg-[color:var(--bg-3)] hover:text-[color:var(--fg)]"
        >
          {copied ? (
            <>
              <Check
                aria-hidden="true"
                className="size-3"
              />
              Copied
            </>
          ) : (
            <>
              <Copy
                aria-hidden="true"
                className="size-3"
              />
              Copy
            </>
          )}
        </button>
      </div>
    </motion.div>
  )
}
