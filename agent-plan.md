When starting a task by moving it to "In Progress", we want to assign an agent
to it. We'll start using Codex from Open AI
(https://developers.openai.com/codex/sdk). We'll need a set up page when you
start the app where you can configure the agent Providers which is just Codex
for now. Eitehr using the CLI and your already set up codex instance or using an
API key.

We'll get a thread id back from Codex and we'll have to store that in a task. I
expect that there will be multiple threads per task in the future so keep that
in mind.

Inside the task view in the UI, if the task is in TODO, we'll show a "Start
Work" button and if there is a thread we'll need to show the output from the
agent. in that pane. I'm thinkng we'll have two tabs. One for the overview and
one for the agent.

When starting a tasks, there might be other tasks already running in the same
project. To avoid conflicts, we'll need to run each task isolated in their own
worktree.

Lets brainstorm on this!
