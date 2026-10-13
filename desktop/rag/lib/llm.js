import 'dotenv/config';
import { Agent, setGlobalDispatcher } from 'undici';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';

const LLM_HOST = process.env.LLM_HOST || 'http://10.10.10.4:8080';

// These are read from process.env freshly on every call (functions, not
// consts captured once at import time) so that switching the model in
// the app's Settings UI — which just rewrites these process.env vars —
// takes effect on the very next request, without restarting the app.
function getLlmProvider() {
  return process.env.LLM_PROVIDER || 'llama'; // 'llama', 'openrouter', or 'gemini' — used by chat()
}
// agent.js's tool-calling needs a model/server that actually supports
// tool-calling correctly — separate from LLM_PROVIDER so you can keep
// plain chat on your local llama-server while the agent uses whichever
// provider reliably calls tools for you. Falls back to LLM_PROVIDER if
// not set separately.
function getAgentLlmProvider() {
  return process.env.AGENT_LLM_PROVIDER || getLlmProvider();
}

// llama-server chat responses can take a while on CPU/long context — raise
// the default timeouts so undici doesn't kill the request early.
setGlobalDispatcher(new Agent({ headersTimeout: 600_000, bodyTimeout: 600_000 }));

// Created whenever a key is present. Nothing in the pipeline uses this by
// default anymore (knowledgeAgent.js and configAgent.js both run against
// llama-server), but it's kept available in case you want to switch an
// agent back to OpenRouter later.
const openrouter = process.env.OPENROUTER_API_KEY
  ? new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY,
    })
  : null;

const gemini = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

// IFM's K2 Horizon — OpenAI-compatible chat completions endpoint, same
// shape as OpenRouter, so it reuses the same OpenAI SDK client pattern
// just pointed at a different baseURL/key.
const k2Horizon = process.env.K2_HORIZON_KEY
  ? new OpenAI({
      baseURL: 'https://api.ifm.ai/v1',
      apiKey: process.env.K2_HORIZON_KEY,
    })
  : null;

// Embedding (embed(), embedOllama/embedOpenRouter/embedLlamaCpp) used to
// live here — removed once knowledge-base search/ingest moved to the
// shared knowledge-server (see junos-rag-assistant/knowledge-server/lib/
// embed.js, which now has its own copy of this same logic). Nothing in
// this app embeds anything locally anymore.

/**
 * Chat against your llama-server, streaming the SSE response and
 * concatenating it into a single string. `model` is required by the
 * OpenAI-compatible schema but llama-server ignores its value.
 */
async function chatLlama(messages) {
  const res = await fetch(`${LLM_HOST}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.LLM_API_KEY ? { Authorization: `Bearer ${process.env.LLM_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL || 'llama-3.1-8b',
      messages,
      stream: true,
    }),
  });

  if (!res.ok) throw new Error(`Chat failed: ${res.status} ${await res.text()}`);

  let fullText = '';
  for await (const chunk of res.body) {
    const lines = Buffer.from(chunk)
      .toString('utf-8')
      .split('\n')
      .filter((l) => l.startsWith('data: '));
    for (const line of lines) {
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') continue;
      const parsed = JSON.parse(payload);
      const delta = parsed.choices?.[0]?.delta?.content;
      if (delta) {
        fullText += delta;
        process.stdout.write(delta); // live stream to the terminal
      }
    }
  }
  console.log(); // newline after streaming finishes
  return fullText;
}

/**
 * Chat against OpenRouter's free-tier models (e.g.
 * nvidia/nemotron-3.5-lightning:free). Not streamed — OpenRouter's
 * response comes back as one object, so we print it once it arrives.
 * `reasoning_details` (the model's chain-of-thought, when the model
 * supports it) is attached to the returned message; pass it back
 * unmodified in a later turn's assistant message if you want the model
 * to continue reasoning from where it left off instead of starting over.
 */
async function chatOpenRouter(messages) {
  const res = await openrouter.chat.completions.create({
    model: process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3.5-lightning:free',
    messages,
    reasoning: { enabled: true },
  });

  if (!res?.choices?.[0]?.message) {
    throw new Error(`OpenRouter returned an unexpected response: ${JSON.stringify(res)}`);
  }
  const message = res.choices[0].message;

  if (process.env.SHOW_REASONING === 'true' && message.reasoning_details) {
    console.log('--- Reasoning ---');
    console.log(JSON.stringify(message.reasoning_details, null, 2));
    console.log('--- Answer ---');
  }

  console.log(message.content);
  return message.content;
}

// K2 Horizon is a reasoning ("thinking") model. Per IFM's own docs
// (docs.ifm.ai/#/multi-turn, docs.ifm.ai/#/reasoning): every assistant
// message replayed back as history — including ones from earlier in
// the same tool-calling exchange — must carry its reasoning trace back
// in `reasoning_content` (the canonical field name; `reasoning` is an
// accepted mirror kept for older clients, and sending both is
// explicitly called out as harmless), even when that trace is an empty
// string — dropping the field is what triggers "missing a thinking
// field." Their own tool-calling example also uses `content: ""` on a
// tool-call turn, not null. The shared tool-calling loop
// (lib/agentLoop.js) is provider-agnostic and knows none of this — fine
// for the other 3 providers, fatal for this one — so normalize right
// before sending instead of teaching the shared loop one provider's
// quirks.
function normalizeForK2Horizon(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'assistant') {
      // A plain assistant turn with no text and no tool calls carries
      // nothing — drop it rather than send an empty turn.
      if (!String(m.content ?? '').trim() && !m.tool_calls?.length) continue;
      const reasoning = m.reasoning_content ?? m.reasoning ?? '';
      out.push({ ...m, content: m.content ?? '', reasoning_content: reasoning, reasoning });
      continue;
    }
    // K2 Horizon's gateway rejects two user messages in a row (400
    // "Upstream request failed"). That happens whenever an earlier turn got
    // no answer, so its question is left in history with nothing after it —
    // fold consecutive plain user messages into one.
    const prev = out[out.length - 1];
    if (m.role === 'user' && prev?.role === 'user' && typeof m.content === 'string' && typeof prev.content === 'string') {
      out[out.length - 1] = { ...prev, content: `${prev.content}\n\n${m.content}` };
      continue;
    }
    out.push(m);
  }
  return out;
}

// K2 Horizon sometimes returns its thinking inline in `content` instead of
// only in `reasoning_content`, ending it with this marker (the opening tag
// may or may not be present). Everything up to the LAST marker is thinking,
// not answer — it must never be shown to the user or replayed as the
// "answer" in history. No marker means no inline thinking: content is the
// answer as-is.
const K2_THINK_END = '</ifm|think>';
function splitK2Thinking(text) {
  const s = String(text ?? '');
  const i = s.lastIndexOf(K2_THINK_END);
  if (i === -1) return { thinking: '', answer: s };
  return {
    thinking: s.slice(0, i).replace(/<ifm\|think>/g, '').trim(),
    answer: s.slice(i + K2_THINK_END.length).trim(),
  };
}

// 'low' | 'medium' | 'high' — IFM recommends 'high'. Passed through
// chat_template_kwargs per docs.ifm.ai/#/reasoning.
// OFF by default: measured directly against api.ifm.ai with curl, the same
// streamed request returned 200 five times out of five WITHOUT this setting,
// and 400 "Upstream request failed" on 3 of 5 runs WITH it. Set
// K2_HORIZON_SEND_REASONING_EFFORT=true (plus K2_HORIZON_REASONING_EFFORT)
// to send it again once IFM's side is stable.
function k2HorizonReasoningKwargs() {
  if (process.env.K2_HORIZON_SEND_REASONING_EFFORT !== 'true') return {};
  return { chat_template_kwargs: { reasoning_effort: process.env.K2_HORIZON_REASONING_EFFORT || 'high' } };
}

/**
 * Chat against IFM's K2 Horizon endpoint — not streamed, same as
 * chatOpenRouter (OpenRouter-style single-object response).
 */
async function chatK2Horizon(messages) {
  if (!k2Horizon) throw new Error('K2_HORIZON_KEY is not set.');
  const res = await k2Horizon.chat.completions.create({
    model: process.env.K2_HORIZON_MODEL || 'IFM/K2-Horizon-375B-A23B',
    messages: normalizeForK2Horizon(messages),
    ...k2HorizonReasoningKwargs(),
  });

  if (!res?.choices?.[0]?.message) {
    throw new Error(`K2 Horizon returned an unexpected response: ${JSON.stringify(res)}`);
  }
  const message = res.choices[0].message;
  console.log(message.content);
  return message.content;
}

/**
 * Converts an OpenAI-style messages array (system/user/assistant/tool
 * roles, tool_calls with stringified JSON arguments) into Gemini's
 * contents format (user/model roles, functionCall/functionResponse
 * parts, args as a plain object). Gemini has no "system" role — system
 * messages are pulled out and returned separately as systemInstruction.
 * toolCallNames tracks id -> function name so a later tool-result message
 * (which only carries the id) can be turned into a named functionResponse.
 */
function messagesToGeminiContents(messages) {
  let systemInstruction = '';
  const contents = [];
  const toolCallNames = new Map();

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemInstruction += (systemInstruction ? '\n\n' : '') + msg.content;
    } else if (msg.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: msg.content }] });
    } else if (msg.role === 'assistant') {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const parts = msg.tool_calls.map((tc) => {
          toolCallNames.set(tc.id, tc.function.name);
          let args = {};
          try {
            args = JSON.parse(tc.function.arguments || '{}');
          } catch {
            // malformed JSON — fall through with empty args
          }
          return { functionCall: { id: tc.id, name: tc.function.name, args } };
        });
        contents.push({ role: 'model', parts });
      } else {
        contents.push({ role: 'model', parts: [{ text: msg.content || '' }] });
      }
    } else if (msg.role === 'tool') {
      const name = toolCallNames.get(msg.tool_call_id) || 'unknown_function';
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { id: msg.tool_call_id, name, response: { result: msg.content } } }],
      });
    }
  }

  return { systemInstruction, contents };
}

async function chatGemini(messages) {
  if (!gemini) throw new Error('GEMINI_API_KEY is not set.');
  const { systemInstruction, contents } = messagesToGeminiContents(messages);

  const res = await gemini.models.generateContent({
    model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    contents,
    ...(systemInstruction ? { config: { systemInstruction } } : {}),
  });

  console.log(res.text);
  return res.text;
}

export async function chat(messages) {
  const provider = getLlmProvider();
  if (provider === 'openrouter') return chatOpenRouter(messages);
  if (provider === 'gemini') return chatGemini(messages);
  if (provider === 'k2horizon') return chatK2Horizon(messages);
  return chatLlama(messages);
}

/**
 * Tool-calling chat — non-streaming, since we need the full structured
 * response (including any tool_calls) rather than a token stream.
 * Returns the raw assistant message object: either
 * { content: "..." } (final answer) or { tool_calls: [...] } (the model
 * wants to call one or more tools before answering).
 */
export async function chatWithToolsLlama(messages, tools) {
  // Non-streaming means nothing prints until the whole response is done —
  // on a CPU-only server that can take minutes, especially with a large
  // tool-result message in context, and looks indistinguishable from a
  // hang. Print size + a heartbeat so it's obvious it's just working.
  const approxChars = JSON.stringify(messages).length;
  console.log(`[llama] sending request (~${approxChars} chars of context, tools ${tools ? 'on' : 'off'}) — this can take a while on CPU...`);
  const started = Date.now();
  const heartbeat = setInterval(() => {
    console.log(`[llama] still waiting... (${Math.round((Date.now() - started) / 1000)}s)`);
  }, 20_000);

  try {
    const res = await fetch(`${LLM_HOST}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.LLM_API_KEY ? { Authorization: `Bearer ${process.env.LLM_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || 'llama-3.1-8b',
        messages,
        ...(tools ? { tools, tool_choice: 'auto' } : {}),
        stream: false,
      }),
    });

    if (!res.ok) throw new Error(`Chat (tools) failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    console.log(`[llama] response received after ${Math.round((Date.now() - started) / 1000)}s`);
    return data.choices[0].message;
  } finally {
    clearInterval(heartbeat);
  }
}

export async function chatWithToolsOpenRouter(messages, tools, onToken) {
  if (!onToken) {
    const res = await openrouter.chat.completions.create({
      model: process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3.5-lightning:free',
      messages,
      ...(tools ? { tools, tool_choice: 'auto' } : {}),
    });
    // OpenRouter occasionally returns a 200 with an error/empty body
    // instead of throwing (rate limiting, a model that rejected
    // tool_choice, content filtering, etc.) — surface exactly what came
    // back instead of a cryptic "Cannot read properties of undefined" a
    // few frames up.
    if (!res?.choices?.[0]?.message) {
      throw new Error(`OpenRouter (tools) returned an unexpected response: ${JSON.stringify(res)}`);
    }
    return res.choices[0].message;
  }

  // Streaming path — only taken when a caller wants live tokens (see
  // main.js's ai:chat handler). Accumulates content and tool_calls chunk
  // by chunk; onToken is called with the FULL content-so-far after each
  // delta (not just the new fragment) so callers can do a plain replace
  // rather than track append offsets — this also makes each round of a
  // multi-round tool-calling loop self-correct in the UI automatically,
  // since a fresh call here starts its own fresh accumulation.
  const stream = await openrouter.chat.completions.create({
    model: process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3.5-lightning:free',
    messages,
    stream: true,
    ...(tools ? { tools, tool_choice: 'auto' } : {}),
  });

  let content = '';
  const toolCalls = {};

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;
    if (delta.content) {
      content += delta.content;
      onToken(content);
    }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCalls[idx]) toolCalls[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (tc.id) toolCalls[idx].id = tc.id;
        if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
        if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
      }
    }
  }

  const tool_calls = Object.values(toolCalls);
  return {
    content: content || null,
    ...(tool_calls.length > 0 ? { tool_calls } : {}),
  };
}

/**
 * Tool-calling chat against Gemini. Returns the same OpenAI-shaped
 * message object as chatWithToolsLlama/chatWithToolsOpenRouter — either
 * { content: "..." } or { tool_calls: [...] } with each tool call's
 * arguments as a stringified JSON string — so it drops straight into
 * runAgentLoop (lib/agentLoop.js) without that file needing to know
 * which provider it's talking to.
 */
export async function chatWithToolsGemini(messages, tools) {
  if (!gemini) throw new Error('GEMINI_API_KEY is not set.');
  const { systemInstruction, contents } = messagesToGeminiContents(messages);

  const config = {};
  if (systemInstruction) config.systemInstruction = systemInstruction;
  if (tools) {
    config.tools = [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      },
    ];
  }

  const res = await gemini.models.generateContent({
    model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    contents,
    config,
  });

  if (res.functionCalls && res.functionCalls.length > 0) {
    return {
      content: null,
      tool_calls: res.functionCalls.map((fc, i) => ({
        id: fc.id || `call_${Date.now()}_${i}`,
        type: 'function',
        function: { name: fc.name, arguments: JSON.stringify(fc.args || {}) },
      })),
    };
  }

  return { content: res.text };
}

// The gateway's own 400 text ("Upstream request failed: Bad Request") says
// nothing about WHICH part of the request it rejected. This logs what we
// actually sent (shape only — no message content, so no config text or
// secrets ever land in a log) plus the full error body the SDK received,
// so the real cause can be read off instead of guessed.
export async function chatWithToolsK2Horizon(messages, tools, onToken) {
  // Debug switch for bisecting a gateway 400: K2_HORIZON_DROP_TOOLS=a,b
  // removes those tools from the request (comma-separated tool names).
  // Unset in normal use. Read from process.env on every call, so editing
  // .env and restarting the app is enough — no rebuild.
  const dropList = (process.env.K2_HORIZON_DROP_TOOLS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (tools && dropList.length) {
    tools = tools.filter((t) => !dropList.includes(t.function?.name));
  }
  // K2 Horizon's gateway returns "400 Upstream request failed" for streamed
  // requests that the identical non-streamed request handles fine (verified
  // directly with curl: same body, stream:false -> 200, stream:true -> 400),
  // and streamed replies sometimes end with finish_reason "tool_calls" but no
  // tool call attached. So K2 is non-streaming by default: the answer shows
  // up when complete instead of token by token (status lines still update
  // per tool call). Set K2_HORIZON_STREAM=true to turn streaming back on.
  if (process.env.K2_HORIZON_STREAM !== 'true') onToken = undefined;
  // Recovery 1: K2's streamed replies sometimes end with nothing usable
  // (finish_reason "tool_calls" but no call attached, or an outright empty
  // reply). Retry once WITHOUT streaming — the gateway's tool-call handling
  // may behave differently on that path. Logged either way.
  const attempt = async (msgs) => {
    const result = await chatWithToolsK2HorizonInner(msgs, tools, onToken);
    if (onToken && !result.content && !(result.tool_calls && result.tool_calls.length)) {
      console.error('[k2horizon] empty streamed reply — retrying once without streaming');
      const second = await chatWithToolsK2HorizonInner(msgs, tools, undefined);
      console.error(
        `[k2horizon] non-streaming retry: ${second.tool_calls?.length ? 'got tool call(s)' : second.content ? 'got an answer' : 'still empty'}`
      );
      return second;
    }
    return result;
  };

  // Recovery 2: K2's gateway fails SOME requests at random with
  // "400 Upstream request failed" — the identical request often succeeds on
  // the next try (verified with curl). Retry the SAME request up to 2 more
  // times with a short pause before giving up. Only for that specific
  // upstream error; any other error is thrown immediately.
  const isUpstream400 = (e) =>
    e?.status === 400 && /upstream request failed/i.test(String(e?.error?.message ?? e?.message ?? ''));
  let err;
  for (let tryNo = 1; tryNo <= 3; tryNo++) {
    try {
      const result = await attempt(messages);
      if (tryNo > 1) console.error(`[k2horizon] succeeded on attempt ${tryNo}`);
      return result;
    } catch (e) {
      err = e;
      if (!isUpstream400(e) || tryNo === 3) break;
      console.error(`[k2horizon] upstream 400 on attempt ${tryNo}/3 — retrying the same request`);
      await new Promise((r) => setTimeout(r, 500 * tryNo));
    }
  }
  {
    console.error(
      '[k2horizon] request failed:',
      JSON.stringify({
        status: err?.status,
        body: err?.error ?? err?.message,
        messageCount: messages.length,
        roles: messages.map((m) => m.role).join(','),
        // Per message: role, content length, and counts of characters that
        // commonly make a gateway reject JSON (control chars, lone
        // surrogates). Lengths and counts only — never the content itself.
        messageStats: messages.map((m) => {
          const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
          return {
            role: m.role,
            len: c.length,
            control: (c.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g) || []).length,
            loneSurrogate: (c.match(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g) || []).length,
            hasToolCalls: !!m.tool_calls,
            reasoningLen: String(m.reasoning_content ?? '').length,
          };
        }),
        toolNames: (tools || []).map((t) => t.function?.name),
        toolsBytes: JSON.stringify(tools || []).length,
        streaming: !!onToken,
      })
    );
    throw err;
  }
}

async function chatWithToolsK2HorizonInner(messages, tools, onToken) {
  if (!k2Horizon) throw new Error('K2_HORIZON_KEY is not set.');

  if (!onToken) {
    const res = await k2Horizon.chat.completions.create({
      model: process.env.K2_HORIZON_MODEL || 'IFM/K2-Horizon-375B-A23B',
      messages: normalizeForK2Horizon(messages),
      ...k2HorizonReasoningKwargs(),
      ...(tools ? { tools, tool_choice: 'auto' } : {}),
    });
    if (!res?.choices?.[0]?.message) {
      throw new Error(`K2 Horizon (tools) returned an unexpected response: ${JSON.stringify(res)}`);
    }
    const message = res.choices[0].message;
    // Carry the real reasoning trace forward on the message object we
    // hand back, so when agentLoop.js replays this turn as history on the
    // next round, the model gets its own actual trace back — required
    // verbatim per docs.ifm.ai/#/reasoning, not just a placeholder empty
    // string.
    const split = splitK2Thinking(message.content);
    const reasoning = message.reasoning_content ?? message.reasoning ?? split.thinking ?? '';
    return {
      ...message,
      content: typeof message.content === 'string' ? split.answer : message.content,
      reasoning_content: reasoning,
      reasoning,
    };
  }

  // Streaming path. Per docs.ifm.ai/#/streaming: reasoning_content and
  // content arrive as separate deltas — buffered independently here.
  // Only content is surfaced via onToken (reasoning isn't shown in the
  // chat UI). Tool call argument fragments are accumulated per index and
  // only parsed once the stream ends, per the same docs ("a partial
  // fragment is almost never valid JSON on its own") — agentLoop.js does
  // that parsing, this just needs to hand back a complete arguments
  // string. A stream that ends without a finish_reason is treated as
  // truncated and rejected rather than silently returning partial junk.
  const stream = await k2Horizon.chat.completions.create({
    model: process.env.K2_HORIZON_MODEL || 'IFM/K2-Horizon-375B-A23B',
    messages: normalizeForK2Horizon(messages),
    stream: true,
    ...k2HorizonReasoningKwargs(),
    ...(tools ? { tools, tool_choice: 'auto' } : {}),
  });

  let content = '';
  let reasoning = '';
  const toolCalls = {};
  let finishReason = null;
  const deltaKeysSeen = new Set();

  for await (const chunk of stream) {
    const choice = chunk.choices?.[0];
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    const delta = choice?.delta;
    if (!delta) continue;
    for (const k of Object.keys(delta)) deltaKeysSeen.add(k);
    if (delta.reasoning_content) reasoning += delta.reasoning_content;
    if (delta.content) {
      content += delta.content;
      // Only surface text once the inline-thinking end marker has been seen
      // (everything before it is thinking). A reply that never contains the
      // marker simply shows up when the stream completes — the renderer
      // always treats the final result as authoritative anyway.
      if (content.includes(K2_THINK_END)) onToken(splitK2Thinking(content).answer);
    }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCalls[idx]) toolCalls[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (tc.id) toolCalls[idx].id = tc.id;
        if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
        if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
      }
    }
  }

  if (!finishReason) {
    throw new Error('K2 Horizon stream ended without a finish_reason — treating as truncated.');
  }

  const tool_calls = Object.values(toolCalls);
  const split = splitK2Thinking(content);
  const fullReasoning = reasoning || split.thinking;
  if (!split.answer && tool_calls.length === 0) {
    // Nothing usable came back — record why, so it isn't a guess.
    console.error(
      '[k2horizon] empty reply:',
      JSON.stringify({
        finishReason,
        rawContentLen: content.length,
        hadThinkMarker: content.includes(K2_THINK_END),
        reasoningLen: reasoning.length,
        thinkingLenFromContent: split.thinking.length,
        // Which fields the stream actually used — a tool call sent in a
        // field we don't read would show up here.
        deltaKeysSeen: [...deltaKeysSeen],
        // End of the model's thinking (local terminal only): if the tool
        // call was written out as plain text in there, it will be visible.
        reasoningTail: reasoning.slice(-500),
      })
    );
  }
  return {
    content: split.answer || null,
    ...(tool_calls.length > 0 ? { tool_calls } : {}),
    reasoning_content: fullReasoning,
    reasoning: fullReasoning,
  };
}

export async function chatWithTools(messages, tools, onToken) {
  const provider = getAgentLlmProvider();
  if (provider === 'openrouter') return chatWithToolsOpenRouter(messages, tools, onToken);
  if (provider === 'gemini') return chatWithToolsGemini(messages, tools);
  if (provider === 'k2horizon') return chatWithToolsK2Horizon(messages, tools, onToken);
  return chatWithToolsLlama(messages, tools);
}
