import dayjs from 'dayjs'
import { motion } from 'framer-motion'
import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { cn } from '../lib/utils'

interface AgentMessageCardProps {
  text: string
  timestamp?: string | null
  streaming?: boolean
  className?: string
}

const fadeIn = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.25, ease: 'easeOut' as const }
}

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
  className
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
      {...fadeIn}
      className={cn('group flex flex-col', className)}
    >
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-[11.5px] font-medium text-[color:var(--fg-3)]">
          Agent
        </span>
        {time ? (
          <span className="font-mono text-[10.5px] text-[color:var(--fg-4)]">
            {time}
          </span>
        ) : null}
      </div>

      <div className="prose prose-sm prose-agent max-w-none text-[13.5px] leading-[1.55] text-[color:var(--fg)] dark:prose-invert">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        {streaming ? (
          <span
            aria-hidden="true"
            className="ml-0.5 inline-block animate-cursor-blink text-[color:var(--accent)]"
          >
            ▍
          </span>
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
