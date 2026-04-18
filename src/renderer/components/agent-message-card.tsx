import { motion } from 'framer-motion'
import { Check, Copy, Sparkles } from 'lucide-react'
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { cn } from '../lib/utils'
import { Button } from './ui/button'

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

  return (
    <motion.div
      {...fadeIn}
      className={cn(
        'group relative rounded-xl border bg-card px-4 py-4 sm:px-5',
        'before:absolute before:left-0 before:top-3.5 before:bottom-3.5 before:w-[3px] before:rounded-full before:bg-banana',
        className
      )}
    >
      <div
        className='mb-2 flex items-center gap-2 font-display text-[10.5px] font-semibold uppercase tracking-[0.16em] text-banana'
      >
        <Sparkles
          aria-hidden='true'
          className='size-3'
        />
        <span>Agent</span>
        {timestamp ? (
          <span className='font-mono font-normal normal-case tracking-normal text-muted-foreground'>
            · {timestamp}
          </span>
        ) : null}
      </div>

      <div className='prose prose-sm prose-agent dark:prose-invert max-w-none text-[15px] leading-relaxed'>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        {streaming ? (
          <span
            aria-hidden='true'
            className='ml-0.5 inline-block animate-cursor-blink text-banana'
          >
            ▍
          </span>
        ) : null}
      </div>

      <div className='mt-2 flex gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100'>
        <Button
          type='button'
          size='sm'
          variant='ghost'
          className='h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground'
          onClick={onCopy}
        >
          {copied ? (
            <>
              <Check className='size-3' /> Copied
            </>
          ) : (
            <>
              <Copy className='size-3' /> Copy
            </>
          )}
        </Button>
      </div>
    </motion.div>
  )
}
