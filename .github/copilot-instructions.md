# code-monkey — Copilot Instructions

See `AGENTS.md` and `CLAUDE.md` for engineering conventions, code style, and
tooling. The section below mirrors the design context from `.impeccable.md` so
design-related suggestions stay grounded.

## Design Context

### Users

Professional developers at small teams who orchestrate coding agents on real
codebases. They live in editors, terminals, and git — code-monkey is the
cockpit they sit in *next to* those tools, not a replacement for them. They run
multiple tasks at once, each in its own worktree, and they need to read agent
output, intervene, approve, and ship. They are keyboard-fluent and impatient
with chrome that gets in the way.

They are *not* learners and they are *not* enterprise admins. The interface
should respect that they know what a worktree is, what an SSE stream looks
like, and what a thread id means — without rubbing their face in it.

### Brand Personality

**Inviting · crafted · quietly playful.**

The product is called "code-monkey." The name sets the tone. The interface
should feel warm and approachable — a workbench you actually want to open —
without sliding into mascot territory or SaaS cheer. Think a well-loved
mechanical keyboard, not a children's app. The "banana" accent is the lone
note of color in an otherwise calm room: it shows up where attention is
*earned*, not as decoration.

Voice is direct, lower-case-comfortable, never preachy. Empty states and error
copy can have personality. Headers and labels stay quiet.

### Aesthetic Direction

**References:** Linear (restraint, density without crowding, keyboard-first
micro-interactions), Raycast and Arc (native-feeling desktop chrome, refined
type at small sizes, command palette ergonomics), Zed and Cursor
(editor-adjacent, comfortable with monospace and source artifacts).

**Anti-references:**

- **Cyberpunk dev-tool tropes** — no neon-on-black, no glowing accents, no
  gradient-text metrics, no "hacker terminal" cosplay. The dark theme should
  feel like a quiet room at dusk, not a server rack.
- **Heavy chrome and browser-in-browser** — no nested cards, no glassmorphism,
  no modal stacks. This is a desktop app; it should feel like one. Surfaces
  should be flat, borders thin, shadows minimal.

**Theme:** Light and dark are equal citizens. Default to whichever the OS
prefers. Both themes use cool neutrals tinted faintly toward the violet hue
(270) so the accent never feels imported.

**Typography:** Inter for UI, JetBrains Mono for code, identifiers, and
anything the user might copy. Body sits at 13px — desktop density, not web
generosity. Use weight and size for hierarchy; avoid color for hierarchy.

**Color:** Neutrals do the heavy lifting. The violet accent is reserved for
the one thing on screen that *matters right now* — the active tab, the
attention-needed pulse, the primary action when there is one. State colors
(blue/green/amber/red) earn their keep on status pills and nothing else.

### Design Principles

1. **Native first, web second.** The app lives inside Electron but should not
   announce it. Window chrome, focus rings, scroll behavior, and motion should
   match the host OS's expectations. Nothing should feel like a webpage that
   stowed away in a desktop frame.

2. **Density with room to breathe.** Pros want information on screen. Pack it
   in — but use rhythm, not uniform padding, to make it readable. Tight where
   things relate, generous where they don't.

3. **The accent is precious.** Violet appears in at most one or two places per
   screen. If everything is highlighted, nothing is. Reach for neutrals first.

4. **Quietly playful, never cute.** Personality lives in copy, microcopy, and
   the occasional unexpected detail — not in mascots, illustrations, or
   rounded-everything. The banana is a wink, not a brand.

5. **Make the machinery legible.** Worktrees, threads, agents, approvals — the
   user chose this tool because they want to see the gears. Surface state
   honestly. Don't hide complexity behind reassuring spinners.
