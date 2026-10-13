import { sanitizeForPrompt } from './sanitize.js';
import { checkForInjectionAttempt } from './layaRouter.js';

// Logged, not blocked: a false positive here must never break a real tool
// result, so this is visibility only (defense-in-depth on top of the
// <instruction_hierarchy> prompt wording, not a replacement for it). Once
// there's a track record of how this behaves on real traffic, a high-
// confidence flag could graduate to actually stripping/rejecting the
// content — not done yet, deliberately, to avoid breaking legitimate tool
// output on an unproven classifier.
//
// Deliberately much lower than the 0.85 used for the config fast path —
// that threshold gates an ACTION (skip careful LLM reasoning), so it needs
// to be strict. This only ever produces a log line for a human to review,
// so the risk calculus flips: a false positive costs one extra log line,
// a false negative costs a missed real injection attempt. Measured
// against a clear-cut test case, the checkpoint correctly separates a
// benign string (~0.34) from an obvious injection (~0.63) around the 0.5
// midpoint, just without much margin — so flag anything above it.
const INJECTION_GUARD_THRESHOLD = 0.5;

const STATUS_TEXT_LIMIT = 100;
const truncate = (s, n = STATUS_TEXT_LIMIT) =>
  typeof s === 'string' && s.length > n ? `${s.slice(0, n - 1)}…` : s || '';

// Turns a tool call into a short, human-readable line for the chat UI's
// live status indicator (see onStatus below) — purely cosmetic, never
// affects what the model actually does. Falls back to a generic "Running
// X..." for any tool not explicitly named here, so a newly added tool
// never breaks this, it just gets a less specific label.
function describeToolCall(fnName, args = {}) {
  switch (fnName) {
    case 'search_knowledge_base':
      return `Searching knowledge base for "${truncate(args.query)}"...`;
    case 'get_interface_config':
      return args.interface
        ? `Looking up ${args.interface}${args.unit ? `.${args.unit}` : ''} config on ${args.device_ip}...`
        : `Searching ${args.device_ip} for unit ${args.unit}...`;
    case 'search_switch_config':
      return `Searching ${args.device_ip}'s configuration for "${truncate(args.keyword)}"...`;
    case 'run_show_command':
      return `Running "${truncate(args.command)}" on ${args.device_ip}...`;
    case 'bulk_search_config':
      return `Searching stored configs for "${truncate(args.keyword)}"...`;
    case 'lookup_device_name':
      return `Looking up the device name for ${args.ip}...`;
    case 'lookup_device_ip':
      return `Looking up the IP address for ${args.name}...`;
    case 'search_customers':
      return `Searching customers for "${truncate(args.query)}"...`;
    case 'get_full_config':
      return `Fetching the full configuration for ${args.device_ip}...`;
    case 'run_live_diagnostics':
      return `Running live diagnostics on ${args.device_ip}: ${truncate(args.task)}`;
    case 'save_knowledge_correction':
      return `Saving a knowledge base correction: "${truncate(args.topic)}"...`;
    case 'get_link_history':
      return String(args.current_only).toLowerCase() === 'true'
        ? `Checking current status for ${args.record_key} (${args.service_type})...`
        : `Checking history for ${args.record_key} (${args.service_type})...`;
    case 'get_current_status':
      return `Checking current status for ${args.record_key} (${args.service_type})...`;
    case 'check_utilization_trend':
      return `Checking ${args.metric} trend for ${args.record_key}...`;
    default:
      return `Running ${fnName}...`;
  }
}

/**
 * Shared tool-calling loop, used by any agent (knowledge, config, or the
 * older single combined agent). Given a chat function, a set of tools,
 * and their implementations, this drives the call/respond/call-again
 * cycle until the model produces a final plain-text answer.
 */
export async function runAgentLoop({
  messages,
  tools,
  toolImplementations,
  chatFn,
  // 6 was fine for a single doc lookup or one live-config check, but a
  // full runbook walk (checking an interface across several candidate
  // devices, then ARP, ping, and multiple neighbor-side checks) can
  // legitimately need well more than that — raised so a real multi-step
  // diagnosis doesn't get cut off partway through and mistaken for a loop.
  maxIterations = 20,
  label = '',
  // Once true, tools stop being offered after the first tool-call round.
  // This exists ONLY as a workaround for llama-server's strict tool-call
  // grammar crashing on the answer-writing step (see configAgent.js /
  // agent.js). OpenRouter doesn't have that problem and CAN do genuine
  // multi-hop tool use (e.g. a second, refined search) — forcing this on
  // for it instead causes the model to try calling a tool it's no longer
  // offered, leaking malformed tool-call syntax into the answer text.
  // Only pass true for agents backed by llama-server.
  dropToolsAfterFirstRound = true,
  // Optional (text: string) => void, called with the full content-so-far
  // of whatever's currently generating, for providers/chatFns that
  // support it (see chatWithToolsOpenRouter/K2Horizon in lib/llm.js).
  // Ignored entirely by chatFns that don't accept a third argument —
  // JS simply drops the extra param, no signature change forced on them.
  onToken,
  // Optional (status: string) => void, called right before each tool call
  // actually executes, with a short human-readable description of what's
  // happening (see describeToolCall above) — e.g. "Searching knowledge
  // base for...", "Running live diagnostics on 10.0.0.1: ...". Purely a
  // UI affordance for the chat sidebar's "what's it doing right now"
  // indicator; unlike onToken this fires for every provider, including
  // ones that don't support token streaming, since it's driven by the
  // tool loop itself, not the model's own output.
  onStatus,
}) {
  const tag = label ? `[${label}] ` : '';
  let toolsHaveBeenCalled = false;
  let emptyReplyRetried = false;

  for (let i = 0; i < maxIterations; i++) {
    const offerTools = dropToolsAfterFirstRound ? !toolsHaveBeenCalled : true;
    const message = await chatFn(messages, offerTools ? tools : undefined, onToken);

    if (process.env.DEBUG_AGENT === 'true') {
      // stderr, not stdout — keeps stdout clean for callers (like the
      // Electron chatOnce.js bridge) that parse the final JSON answer
      // from stdout. Still shows up in an interactive terminal either way.
      console.error(`[debug ${tag}]`.trim(), JSON.stringify(message, null, 2));
    }

    if (!message.tool_calls || message.tool_calls.length === 0) {
      // A blank final answer is never useful — observed with K2 Horizon
      // after tool calls ran (the model produced neither a next tool call
      // nor an answer). Nudge once instead of handing the user an empty
      // reply; a second blank reply is returned as-is rather than looping.
      if (!String(message.content ?? '').trim() && !emptyReplyRetried && i < maxIterations - 1) {
        emptyReplyRetried = true;
        // Resend the SAME messages — deliberately not adding a nudge
        // message: K2 Horizon's gateway rejects two user messages in a row
        // (400), and the last message here is usually a user message.
        console.error(`${tag}[agent loop] empty reply from the model — retrying once unchanged`);
        continue;
      }
      return message.content;
    }

    toolsHaveBeenCalled = true;
    messages.push({
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.tool_calls,
      // Some providers (e.g. K2 Horizon, a reasoning model — see
      // normalizeForK2Horizon in lib/llm.js) attach a reasoning trace to
      // the message that must be replayed back verbatim when it's
      // resent as history on the next round, or their API rejects the
      // request. No-op for providers that never set these.
      ...(message.reasoning_content !== undefined ? { reasoning_content: message.reasoning_content } : {}),
      ...(message.reasoning !== undefined ? { reasoning: message.reasoning } : {}),
    });

    // Tool calls WITHIN one round run concurrently, not one after another.
    // The model often asks for several independent things in a single
    // round — e.g. RULE 8's runbook walk checking a handful of candidate
    // devices, or several show commands across different devices — and
    // none of them depend on each other's results within that same round
    // (a call that needs a previous call's output is, by construction, in
    // a LATER round instead). Running them serially just adds up each
    // one's SSH/HTTP round-trip time for no benefit. Tool implementations
    // that touch a shared per-device resource serialize themselves where
    // it actually matters (see runDeviceShowCommandQueued in main.js,
    // which queues same-host calls behind each other while still letting
    // different hosts run in parallel) — from this loop's point of view,
    // calling them concurrently is always safe. Promise.all preserves
    // array order regardless of which finishes first, so the pushed
    // tool-result messages stay in the same order the model requested
    // them, even though execution order isn't guaranteed.
    const toolResultMessages = await Promise.all(
      message.tool_calls.map(async (toolCall) => {
        const fnName = toolCall.function.name;
        let args = {};
        try {
          args = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          // malformed JSON from the model — proceed with empty args rather
          // than crashing; the tool impl will likely report an error back.
        }

        console.error(`${tag}[tool call] ${fnName}(${JSON.stringify(args)})`);

        if (onStatus) {
          try {
            onStatus(describeToolCall(fnName, args));
          } catch {
            // A broken UI callback must never take down the actual agent loop.
          }
        }

        const impl = toolImplementations[fnName];
        const result = impl ? await impl(args) : `Unknown tool: ${fnName}`;
        const rawContent = typeof result === 'string' ? result : JSON.stringify(result);

        // Second, independent injection check on top of the tag-stripping
        // below — a Laya noul scan of the raw tool output, purely advisory
        // (see INJECTION_GUARD_THRESHOLD's comment above). Never awaited in
        // a way that can throw or block: checkForInjectionAttempt() itself
        // never throws, and a null/low result just means "nothing to log."
        try {
          const guardResult = await checkForInjectionAttempt(rawContent);
          if (guardResult && guardResult.probability >= INJECTION_GUARD_THRESHOLD) {
            console.error(
              `${tag}[injection guard] possible instruction-injection in ${fnName}'s output (p=${guardResult.probability.toFixed(3)}, ${guardResult.durationMs}ms) — content still passed through as usual; investigate the source.`
            );
          }
        } catch {
          // Belt-and-braces: even though checkForInjectionAttempt() already
          // catches its own errors, this must never be the reason a tool
          // result fails to reach the model.
        }

        return {
          role: 'tool',
          tool_call_id: toolCall.id,
          // Tool output — device config text, knowledge-base chunks, live
          // command output, device lookup results — is the highest-risk
          // injection surface here, unlike the user's own typed question:
          // it can contain attacker-influenced text (e.g. a crafted
          // interface description or log line) made to look like an
          // instruction or a fake closing/opening tag. Strip any embedded
          // tags before this ever reaches the model. stripTags (not
          // escape) since tool output doesn't need to render with HTML
          // entities, and a generous maxLength since legitimate config/
          // knowledge chunks can genuinely be long — this guards against
          // injection, not size.
          content: sanitizeForPrompt(rawContent, { stripTags: true, maxLength: 50000 }),
        };
      })
    );

    messages.push(...toolResultMessages);
  }

  // Ran out of budget without the model naturally concluding. Returning a
  // bare "stopped" placeholder here is worse than useless — it reads like
  // an error, not a diagnosis, and throws away everything actually
  // gathered in the tool calls above. Force one last no-tools call so the
  // model has to synthesize a real answer from what it already has.
  messages.push({
    role: 'user',
    content:
      'You have used your entire tool-call budget without reaching a final answer. Tools are no longer available for this turn. Based ONLY on what you already found above, give your best final answer now: state plainly what you confirmed, what remains inconclusive, and what you were not able to check.',
  });
  const finalMessage = await chatFn(messages, undefined, onToken);
  return (
    finalMessage.content ||
    `${tag}Stopped after ${maxIterations} tool calls without a final answer — may be looping.`
  );
}
