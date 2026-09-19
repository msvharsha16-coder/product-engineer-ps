
# Reliable AI Conversation Runtime

Name: Malyavantham Sai Harshavardhan
Email: msvharsha16@gmail.com
Phone: +91 9515963308
Problem statement: Problem 5 — Reliable AI Conversation Runtime
Tech stack: Node.js + Express (backend), React + Vite (frontend), Jest (tests), plain SSE for query streaming.


A small runtime that manages one streamed AI reply from request to a
final outcome, success, rejection, cancellation, timeout, or failure —
and guarantees that only a real success ever gets persisted as one.

## Why this exists

Streaming a model's reply sounds simple until you ask: what happens if
the user cancels halfway through? What if the model takes too long? What
if it errors out after already sending half an answer? If you're not
careful, a broken reply can end up looking identical to a real one in
your database. This project is built specifically so that can't happen
every outcome is tracked through an explicit state machine, and only one
terminal state can ever win.

## Layout

```
server/src/core/
  StateMachine.js    the state machine itself, plus the race-safety guard
  Trace.js           records what happened, in order, with secrets stripped
  Policy.js          decides whether to even try generating a reply
  FakeProvider.js    a scriptable stand-in for a real model, used in tests
  OpenAIProvider.js  the real thing, same interface as the fake one
  Store.js           what gets saved and when
  Orchestrator.js    wires all of the above into one turn

server/src/api/      Express app — streams replies over SSE
server/src/bench/    the verification benchmark (npm run bench)
server/src/__tests__/ one test block per acceptance criterion

client/              React chat UI with a live trace panel
```

## Running it

```bash
cd server && npm install
npm test         # ~1 second, all deterministic
npm run bench     # runs 50 scenarios, checks nothing broke, --- Bench mark
npm start          # http://localhost:4000
```

```bash
cd client && npm install
npm run dev          # http://localhost:5173
```

Send a normal message to see it stream. Send something containing
`blocked_test_input` to see it get rejected before the model is ever
called. Hit Cancel mid-reply, or set the timeout low, to see the other
two ways a turn can end.

### Using the real OpenAI API

By default this runs on a fake, scripted provider — no API key needed.
If you want real replies:

```bash
cd server
cp .env.example .env
# put your key in: OPENAI_API_KEY=sk-...
npm start
```

The server logs which one it's using on boot. Tests and the benchmark
always use the fake provider regardless — that's on purpose, so they stay
free, fast, and don't depend on OpenAI being up.

## How it actually works

**Policy runs first.** Before anything touches the model, a plain
function decides whether the input is even allowed. If it says no, the
provider is never invoked — full stop.

**One state machine owns the outcome.** A turn moves through
`pending → policy_check → streaming → (completed | rejected | cancelled |
timed_out | failed)`. Only one thing is allowed to change that state —
the Orchestrator — and the actual transition is a plain, synchronous
function with no `await` inside it. That last detail matters: Node runs
JavaScript on one thread, so a synchronous check-then-write can't get
interrupted halfway through. If two things both try to end the turn at
almost the same moment (say, the model finishes right as the timeout
fires), whichever one gets there first wins, and the second is silently
rejected — not silently accepted. That's what makes "exactly one terminal
outcome" a real guarantee instead of a hope.

**Cancellation and timeout share one mechanism.** Both use a standard
`AbortController`. Both lock in the state transition *before* firing the
abort — so by the time the model's stream actually throws, the outcome is
already decided, and cleanup just persists whatever partial text had
streamed in.

**What gets saved, and when.** The user's message is always saved,
immediately. The model's reply is only saved as a real message if the
turn reaches `completed`. If it's cancelled, times out, or fails, whatever
text had streamed in is kept on the turn's own record (useful for
debugging) but never shows up in the conversation , a half-finished reply
should never look like a real one.

**The trace tells you what happened, not what the model was thinking.**
Every turn keeps an ordered log , turn created, policy checked, provider
called, chunk received, error, terminal outcome. It never contains the
model's actual output content or hidden reasoning, and any field that
looks like a secret (`apiKey`, `token`, `password`, etc.) gets stripped
before it's ever stored, at any nesting depth. Once a turn reaches its
terminal state, the trace refuses to accept anything after it.

**Same runtime works behind anything.** The Orchestrator doesn't know
about HTTP — it just takes input and gives back a result, plus an
optional callback for streaming. The Express/SSE layer is a thin adapter
on top. Swap it for WebSockets or a mobile client and nothing about the
state machine, persistence, or trace has to change.

## If users could resume a cancelled reply

Right now a cancelled turn's partial text is kept but never becomes part
of the conversation. To support "resume from where it left off," I'd add
a `parentTurnId` so a new turn can say "I'm a continuation of that one,"
seed the new turn's generation with the old partial text, and only commit
a message to the conversation once *that* new turn completes — merging
the partial and the continuation into one. The core rule stays intact:
nothing but a genuinely completed turn ever becomes a real message.
