import { useState } from 'react'

import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'

export type UserInputOption = {
  description: string
  label: string
  preview?: string
}

export type UserInputQuestion = {
  header: string
  multiSelect: boolean
  options: UserInputOption[]
  question: string
}

type UserInputCardProps = {
  questions: UserInputQuestion[]
  resolved: null | { answers: Record<string, string>; error?: string }
  onSubmit: (answers: Record<string, string>) => void
}

export function UserInputCard({
  questions,
  resolved,
  onSubmit
}: UserInputCardProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [otherText, setOtherText] = useState<Record<string, string>>({})
  // Local "I just submitted" flag so the button visually locks immediately
  // after click. The card swaps to <ResolvedRow /> once the agent confirms,
  // but until then we don't want a still-clickable Send button.
  const [submitted, setSubmitted] = useState(false)

  if (resolved) {
    return (
      <ResolvedRow
        questions={questions}
        resolved={resolved}
      />
    )
  }

  const handleSelect = (questionText: string, value: string) => {
    if (submitted) {
      return
    }

    setAnswers((current) => ({ ...current, [questionText]: value }))
  }

  const handleSubmit = () => {
    if (submitted) {
      return
    }

    const finalAnswers: Record<string, string> = {}

    for (const entry of questions) {
      const selection = answers[entry.question]

      if (selection === '__other__') {
        const free = otherText[entry.question]?.trim() ?? ''

        if (free !== '') {
          finalAnswers[entry.question] = free
        }

        continue
      }

      if (selection != null && selection !== '') {
        finalAnswers[entry.question] = selection
      }
    }

    setSubmitted(true)
    onSubmit(finalAnswers)
  }

  const allAnswered = questions.every((entry) => {
    const selection = answers[entry.question]

    if (!selection) return false

    if (selection === '__other__') {
      return (otherText[entry.question]?.trim() ?? '') !== ''
    }

    return true
  })

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-banana/50 bg-banana/5 px-4 py-3">
      <div className="font-display text-[10.5px] font-semibold uppercase tracking-[0.16em] text-banana">
        Question for you
      </div>

      <fieldset
        disabled={submitted}
        className={cn(
          'flex flex-col gap-4 border-0 p-0',
          submitted && 'pointer-events-none opacity-60'
        )}
      >
        {questions.map((entry, index) => (
          <div
            key={`${entry.question}-${index}`}
            className="flex flex-col gap-2"
          >
            <div className="flex items-baseline gap-2">
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {entry.header}
              </span>
              <span className="text-[13px] font-medium text-foreground">
                {entry.question}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              {entry.options.map((option) => {
                const isSelected = answers[entry.question] === option.label

                return (
                  <label
                    key={option.label}
                    className={cn(
                      'flex items-start gap-2 rounded-md border px-3 py-2 text-[13px] transition-colors',
                      submitted ? 'cursor-default' : 'cursor-pointer',
                      isSelected
                        ? 'border-banana/60 bg-banana/10'
                        : !submitted && 'border-border hover:bg-accent/40',
                      !isSelected && submitted && 'border-border'
                    )}
                  >
                    <input
                      type="radio"
                      name={entry.question}
                      value={option.label}
                      checked={isSelected}
                      onChange={() => handleSelect(entry.question, option.label)}
                      className="mt-1"
                    />
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{option.label}</span>
                      <span className="text-[12px] text-muted-foreground">
                        {option.description}
                      </span>
                    </div>
                  </label>
                )
              })}

              <label
                className={cn(
                  'flex items-start gap-2 rounded-md border px-3 py-2 text-[13px] transition-colors',
                  submitted ? 'cursor-default' : 'cursor-pointer',
                  answers[entry.question] === '__other__'
                    ? 'border-banana/60 bg-banana/10'
                    : !submitted && 'border-border hover:bg-accent/40',
                  answers[entry.question] !== '__other__' &&
                    submitted &&
                    'border-border'
                )}
              >
                <input
                  type="radio"
                  name={entry.question}
                  value="__other__"
                  checked={answers[entry.question] === '__other__'}
                  onChange={() => handleSelect(entry.question, '__other__')}
                  className="mt-1"
                />
                <span className="font-medium">Other (write your own)</span>
              </label>

              {answers[entry.question] === '__other__' ? (
                <Textarea
                  value={otherText[entry.question] ?? ''}
                  onChange={(event) =>
                    setOtherText((current) => ({
                      ...current,
                      [entry.question]: event.target.value
                    }))
                  }
                  placeholder="Type your answer"
                  className="min-h-[60px] resize-none text-[13px]"
                />
              ) : null}
            </div>
          </div>
        ))}
      </fieldset>

      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={!allAnswered || submitted}
          onClick={handleSubmit}
        >
          {submitted ? 'Sending…' : 'Send answers'}
        </Button>
      </div>
    </div>
  )
}

function ResolvedRow({
  questions,
  resolved
}: {
  questions: UserInputQuestion[]
  resolved: { answers: Record<string, string>; error?: string }
}) {
  if (resolved.error) {
    return (
      <div className="rounded-lg border border-[color:var(--destructive)]/30 bg-[color:var(--destructive)]/5 px-3 py-1.5 text-[11.5px] text-[color:var(--destructive)]">
        Question canceled — {resolved.error}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-muted-foreground/20 bg-muted/30 px-3 py-2 text-[11.5px] text-muted-foreground">
      <div className="mb-1 font-display text-[10px] font-semibold uppercase tracking-[0.16em]">
        Answered
      </div>
      <ul className="flex flex-col gap-1">
        {questions.map((entry, index) => (
          <li
            key={`${entry.question}-${index}`}
            className="flex flex-col"
          >
            <span className="text-[11px] text-muted-foreground/80">
              {entry.question}
            </span>
            <span className="font-mono text-[11.5px]">
              {resolved.answers[entry.question] ?? '(no answer)'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
