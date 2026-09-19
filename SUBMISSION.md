# Product Engineering Challenge Submission

## Candidate

- **Name:** Malyavantham Sai Harshavardhan
- **Email:** msvharsha16@gmail.com
- **GitHub:** https://github.com/msvharsha16-coder
- **Selected problem:** Problem 5 , Reliable AI Conversation Runtime
- **Demo video:** : https://www.loom.com/share/e1ff91c7364f4446a9c74d9be0e623f3

## Run the project

Prerequisites: Node.js 18+ (needed for the built-in `fetch` used by the OpenAI provider), npm.

No required environment variables to run the default demo, the app falls back to a deterministic fake provider automatically. Optional: `OPENAI_API_KEY` if you want real model output instead of the fake one (see below). No secret values are committed anywhere in this repo.

```text
# backend
cd server
npm install
npm start
# → http://localhost:4000
# logs which provider it's using: FakeProvider (default) or OpenAI (if key is set)

# frontend (separate terminal)
cd client
npm install
npm run dev
# → http://localhost:5173 (proxies /api to :4000)

# optional: real OpenAI instead of the fake provider
cd server
cp .env.example .env
# set OPENAI_API_KEY=sk-... inside .env
If key is needed please feel free to contact me through email i will provide it , i own the open AI license. ( GIT Won't accept open ai keys because of protection policy)
npm start
```

**Successful scenario:** open `http://localhost:5173`, type any normal message, and press Enter. The reply streams in token by token, the trace panel on the right fills in live, and the final trace event reads `terminal → completed`.

**Failure/recovery scenario:** type a message containing the exact text `blocked_test_input` , the policy gate rejects it before the (fake or real) model is ever called. The trace shows `policy_rejected` and `terminal → rejected`, with no `provider_invoked` event anywhere. Alternatively, send any message and click **Cancel** mid-stream, or lower the timeout field below the expected response time, to see the `cancelled` / `timed_out` paths instead.

## Run the tests

```text
cd server
npm test
```

9 tests, one block per acceptance criterion (AC1–AC7), run in under a second. All use the deterministic fake provider , no network calls, no paid API required.

## Acceptance scenarios and verification

All seven acceptance scenarios from the brief are implemented and covered by an automated test:

- **AC1 (successful streamed turn)** - chunks stream in order, run completes once, both user and assistant messages are persisted.
- **AC2 (pre-response rejection)** - policy gate runs before the provider is invoked; proven via a spy provider that asserts it was never called.
- **AC3 (cancellation)** - provider consumption stops mid-stream; a second cancel attempt is a documented no-op; the run cannot later become completed.
- **AC4 (timeout)** - deadline enforced via a timer; tested with Jest fake timers so it runs in milliseconds, not real wall-clock time.
- **AC5 (provider failure)** - partial output preserved on the turn record; failure is traceable without a successful assistant message ever being recorded.
- **AC6 (terminal-state race)** - exactly one terminal transition wins when multiple are attempted back-to-back; tested directly against the state machine.
- **AC7 (safe operational trace)** -trace redacts secret-shaped fields at any nesting depth, and refuses to record anything after a terminal event.

No scenario was intentionally left incomplete or interpreted differently from the brief.

Verification benchmark:

```text
cd server
npm run bench
```

This runs 10 iterations each of the five deterministic scenarios (success, rejection, cancellation, timeout, failure) , 50 runs total , using only the fake provider.

**Observed result** (from a local run): all 50 runs produced exactly the expected terminal state for their scenario (`completed`: 10, `rejected`: 10, `cancelled`: 10, `timed_out`: 10, `failed`: 10), zero rejected runs invoked the provider, zero non-success runs produced a persisted assistant message, and zero trace events appeared after any terminal event. Final line: `OK: all invariants held across 50 runs.`

The failure/recovery scenario shown in the demo video is the policy rejection path (AC2): typing a message containing `blocked_test_input` and showing, live in the trace panel, that `provider_invoked` never appears and the run terminates as `rejected`. A reviewer can reproduce this exactly by typing that same string into the running app.

## Architecture and data flow

The React client sends a message over HTTP and reads back a Server-Sent Events stream from the Express backend. On the server, an `Orchestrator` is the only component allowed to change a turn's state. It runs, in order: a `Policy` check (pure function, no side effects) → if accepted, invokes a `Provider` (an async generator yielding text chunks , `FakeProvider` for tests/benchmark, `OpenAIProvider` for live use, identical interface) → reconciles the outcome into exactly one terminal state via a `StateMachine`. A `Store` persists turn records and conversation messages under a documented commit boundary. A `Trace` keeps an ordered, redacted log of what happened. The Express layer is a thin adapter turning `Orchestrator.execute()`'s plain input/output into SSE frames , none of the core logic knows HTTP exists.

## Technology choices

Node/Express and React because they match my day-to-day production stack, which let me focus the available time on the orchestration logic itself rather than learning new tooling. SSE over WebSockets for streaming, since this problem only needs one-directional server-to-client delivery for a single turn , WebSockets' two-way channel would be unused complexity here. The main trade-off accepted: no database , persistence is in-memory, which is fine for a bounded single-process demo but would need a real store to survive a restart or run in production.

## Important decisions

1. **Terminal-state race handled via synchronous transition, not a lock.** `StateMachine.transition()` does its check-then-write with no `await` inside it, so Node's single-threaded event loop makes it atomic for free ,, whichever caller (completion, cancel, or timeout) reaches it first wins, and every later call is rejected observably rather than silently succeeding.
2. **Persistence boundary is strict about what counts as "real."** The user's message is always saved immediately. The assistant's reply is only added to conversation history if the turn reaches `completed` , cancelled/timed-out/failed turns keep their partial text on the turn record only, never in the message history, so a broken reply can never look like a real one on replay.
3. **Provider is a pure interface, not a concrete dependency.** Both `FakeProvider` and `OpenAIProvider` implement the same `async *stream({ signal, input })` shape, so swapping between deterministic tests and a live model required zero changes to the orchestrator, state machine, or trace logic.

## Assumptions and limitations

- Persistence is in-memory and single-process; it does not survive a server restart. This is acceptable for the scope of this exercise (out-of-scope explicitly excludes cloud deployment and production observability infra) but would need a real database for production use.
- No authentication or multi-user isolation , out of scope per the brief.
- The policy gate is a simple keyword-based rule set, sufficient to demonstrate the pre-response gating mechanism; a production system would use a real content-safety service.
- The in-memory, single-process terminal-state guard (see Important decisions #1) only holds within one process , see Production and scale below.

## Production and scale

The current implementation's biggest scaling limit is the terminal-state race guard: it relies on Node being single-threaded within one process. If this ran behind multiple server instances and a load balancer, two processes could each believe they "won" the race. In production I'd replace the in-memory state machine's guard with a database-level compare-and-swap (e.g., `UPDATE turns SET status = 'completed' WHERE status = 'streaming'`, checking rows affected) so the same guarantee holds across processes. I'd also move the `Store` from in-memory to a real database so turn history survives restarts, and add structured log shipping for the trace events rather than holding them only in memory.

## AI usage

I used Claude (Anthropic) in this project: to design the component boundaries (Policy/Provider/Orchestrator/Store/Trace split), to write the state machine, orchestrator, trace redaction, fake provider, tests, and benchmark script, and to help debug a real issue I hit , an incorrectly-scoped `jest.useFakeTimers()` call that silently broke unrelated tests in the same file. I reviewed and ran all generated code myself (tests pass locally, benchmark runs clean at 50/50), and I can explain and modify any part of this submission.

## Credibility note

At Prosent Pte. Ltd., I built the crosstab analysis and Excel export features for our survey and research analytics platform , a core part of how clients turn raw survey responses into reportable insights. My contribution included the drag-and-drop crosstab builder (rows/columns state management, drop-target handling) and the underlying