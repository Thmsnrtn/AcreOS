#!/usr/bin/env node
// A local stand-in for the model providers both products call.
//
// It speaks the three wire formats the code uses:
//   POST …/chat/completions   (OpenAI / OpenRouter, streaming or not)
//   POST …/messages           (Anthropic Messages, streaming or not)
//   POST …/embeddings         (OpenAI embeddings; deterministic vectors)
//
// Every call is logged to $STANDIN_DIR/calls.jsonl. How a call is answered is
// decided per call by $STANDIN_DIR/rules.json (re-read on every request):
//
//   { "default": "oracle" | "script" | "fail:<status>" | "hang",
//     "rules": [ { "match": "<substring of system+first user msg>", "mode": "…" } ] }
//
// oracle  — the request is written to queue/<id>.json (+ a readable .md) and the
//           HTTP request is held open until answers/<id>.json appears. An agent
//           playing the model writes that answer: {"content": "..."} or
//           {"tool_calls":[{"name":"x","arguments":{...}}]}. Times out to a 503
//           after ORACLE_TIMEOUT_MS so the product sees a real provider failure.
// script  — a structurally valid but content-free answer: schema-shaped JSON
//           when a JSON schema is requested, the first required tool when a tool
//           is forced, otherwise a short neutral sentence. This tests plumbing,
//           never intelligence, and is labelled as such in the log.
// fail:N  — an HTTP N error with a provider-shaped body.
// hang    — never answers (the product's own timeout decides).
// canned:<file> — a fixed answer from a file ({content}|{tool_calls}, or the B2
//           `sequence` / `cases` shapes, below).
// brain:<module.mjs> — SIMPLAT: a deterministic BRAIN computes the answer from
//           the request (tests/simulation/standin/brains/): `capable.mjs` plays a
//           competent employee from what the prompt actually says; `adversarial.mjs`
//           plays one that keeps trying to cross the founder's lines with
//           generated wordings. A brain's answer is logged with brain + verdict
//           metadata (e.g. which attack it attempted) so the scorer can match an
//           attempt to its effect in the world. A brain that returns null falls
//           back to script mode, and says so.
//
// Versioned in the repo from the stage-2 scratch copy (simplat, 2026-10-07):
// the scratch copy is not reproducible, and the brains must be.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = Number(process.env.STANDIN_PORT || 7799);
const DIR = process.env.STANDIN_DIR || path.resolve('standin');
const ORACLE_TIMEOUT_MS = Number(process.env.ORACLE_TIMEOUT_MS || 20 * 60_000);
for (const d of ['queue', 'answers', 'done']) fs.mkdirSync(path.join(DIR, d), { recursive: true });
const LOG = path.join(DIR, 'calls.jsonl');
// Oracle answers are cached by the exact prompt, so a second world that reaches
// the same call reads the same answer (and says so in the log).
const CACHE = process.env.STANDIN_CACHE || path.join(DIR, 'cache');
fs.mkdirSync(CACHE, { recursive: true });
const promptHash = (n) => crypto.createHash('sha256').update(JSON.stringify([n.system, n.messages.map((m) => [m.role, m.content, m.tool_calls ?? null]), n.tools.map((t) => t.name), n.forced, n.schema])).digest('hex');

function rules() {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, 'rules.json'), 'utf8')); }
  catch { return { default: 'script', rules: [] }; }
}
const log = (o) => fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...o }) + '\n');
const est = (s) => Math.ceil((s || '').length / 4);

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => c.text ?? (c.type === 'tool_result' ? textOf(c.content) : '')).join('\n');
  return '';
}

// Normalise both wire formats into one shape the oracle and script modes use.
function normalise(kind, body) {
  if (kind === 'anthropic') {
    const system = typeof body.system === 'string' ? body.system : textOf(body.system);
    const messages = (body.messages || []).map((m) => ({ role: m.role, content: textOf(m.content), raw: m.content }));
    const tools = (body.tools || []).map((t) => ({ name: t.name, description: t.description, schema: t.input_schema }));
    const forced = body.tool_choice?.type === 'tool' ? body.tool_choice.name : body.tool_choice?.type === 'any' ? tools[0]?.name : null;
    return { system, messages, tools, forced, schema: null, model: body.model, stream: !!body.stream, maxTokens: body.max_tokens };
  }
  const msgs = body.messages || [];
  const system = msgs.filter((m) => m.role === 'system').map((m) => textOf(m.content)).join('\n\n');
  const messages = msgs.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: textOf(m.content), tool_calls: m.tool_calls, tool_call_id: m.tool_call_id }));
  const tools = (body.tools || []).map((t) => ({ name: t.function?.name, description: t.function?.description, schema: t.function?.parameters }));
  const forced = typeof body.tool_choice === 'object' ? body.tool_choice.function?.name : body.tool_choice === 'required' ? tools[0]?.name : null;
  const rf = body.response_format;
  const schema = rf?.type === 'json_schema' ? rf.json_schema?.schema : rf?.type === 'json_object' ? { type: 'object' } : null;
  return { system, messages, tools, forced, schema, model: body.model, stream: !!body.stream, maxTokens: body.max_tokens };
}

function pickMode(n) {
  const r = rules();
  const hay = (n.system + '\n' + (n.messages[0]?.content || '')).toLowerCase();
  for (const rule of r.rules || []) if (hay.includes(String(rule.match).toLowerCase())) return { mode: rule.mode, rule: rule.match };
  return { mode: r.default || 'script', rule: null };
}

// ---------- script mode: schema-shaped, content-free ----------
function fromSchema(s, depth = 0) {
  if (!s || depth > 6) return null;
  if (s.enum) return s.enum[0];
  if (s.const !== undefined) return s.const;
  if (s.anyOf || s.oneOf) return fromSchema((s.anyOf || s.oneOf)[0], depth + 1);
  const t = Array.isArray(s.type) ? s.type.find((x) => x !== 'null') : s.type;
  if (t === 'object' || s.properties) {
    const o = {};
    for (const [k, v] of Object.entries(s.properties || {})) if (!s.required || s.required.includes(k)) o[k] = fromSchema(v, depth + 1);
    return o;
  }
  if (t === 'array') return s.minItems ? Array.from({ length: s.minItems }, () => fromSchema(s.items, depth + 1)) : [];
  if (t === 'number' || t === 'integer') return s.minimum ?? 0;
  if (t === 'boolean') return false;
  return 'stand-in';
}
function scriptAnswer(n) {
  if (n.forced) {
    const t = n.tools.find((x) => x.name === n.forced) || n.tools[0];
    return { tool_calls: [{ name: t.name, arguments: fromSchema(t.schema) || {} }] };
  }
  if (n.schema) return { content: JSON.stringify(fromSchema(n.schema) ?? {}) };
  const wantsJson = /respond (only )?(with|in) (valid )?json|return (only )?json|json object/i.test(n.system + (n.messages.at(-1)?.content || ''));
  return { content: wantsJson ? '{}' : 'Nothing further to add.' };
}

// ---------- oracle mode ----------
function renderPrompt(id, kind, n) {
  const parts = [`# Model call ${id} (${kind}, model=${n.model})`, ''];
  parts.push('## How to answer', 'Write answers/' + id + '.json as {"content":"…"} or {"tool_calls":[{"name":"…","arguments":{…}}]}.');
  if (n.schema) parts.push('A JSON response is REQUIRED; content must be a JSON string matching:', '```json', JSON.stringify(n.schema, null, 1).slice(0, 6000), '```');
  if (n.forced) parts.push(`A call to tool \`${n.forced}\` is REQUIRED.`);
  if (n.tools.length) parts.push('## Tools offered', ...n.tools.map((t) => `- **${t.name}**: ${(t.description || '').slice(0, 400)}\n  schema: ${JSON.stringify(t.schema).slice(0, 1500)}`));
  parts.push('', '## System', n.system || '(none)', '');
  for (const m of n.messages) {
    parts.push(`## ${m.role}${m.tool_call_id ? ' (tool result ' + m.tool_call_id + ')' : ''}`, m.content || '');
    if (m.tool_calls) parts.push('tool_calls: ' + JSON.stringify(m.tool_calls));
    parts.push('');
  }
  return parts.join('\n');
}
async function oracleAnswer(id, kind, n, req) {
  fs.writeFileSync(path.join(DIR, 'queue', id + '.json'), JSON.stringify({ id, kind, ...n }, null, 1));
  fs.writeFileSync(path.join(DIR, 'queue', id + '.md'), renderPrompt(id, kind, n));
  const ans = path.join(DIR, 'answers', id + '.json');
  const start = Date.now();
  let gone = false;
  req.on('close', () => { gone = true; });
  while (Date.now() - start < ORACLE_TIMEOUT_MS) {
    if (fs.existsSync(ans)) {
      try {
        const a = JSON.parse(fs.readFileSync(ans, 'utf8'));
        for (const ext of ['.json', '.md']) fs.renameSync(path.join(DIR, 'queue', id + ext), path.join(DIR, 'done', id + ext));
        return a;
      } catch { /* partially written; retry */ }
    }
    if (gone) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  for (const ext of ['.json', '.md']) try { fs.renameSync(path.join(DIR, 'queue', id + ext), path.join(DIR, 'done', id + '.expired' + ext)); } catch {}
  return null;
}

// ---------- wire encoders ----------
function openaiBody(a, n, inTok) {
  const tool_calls = a.tool_calls?.map((t, i) => ({ id: 'call_' + i + '_' + crypto.randomBytes(4).toString('hex'), type: 'function', function: { name: t.name, arguments: JSON.stringify(t.arguments ?? {}) } }));
  const content = a.content ?? null;
  return {
    id: 'chatcmpl-' + crypto.randomBytes(6).toString('hex'), object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: n.model,
    choices: [{ index: 0, message: { role: 'assistant', content, ...(tool_calls ? { tool_calls } : {}) }, finish_reason: tool_calls ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: inTok, completion_tokens: est(content || JSON.stringify(a.tool_calls || '')), total_tokens: inTok + est(content || '') },
  };
}
function anthropicBody(a, n, inTok) {
  const content = [];
  if (a.content) content.push({ type: 'text', text: a.content });
  for (const t of a.tool_calls || []) content.push({ type: 'tool_use', id: 'toolu_' + crypto.randomBytes(6).toString('hex'), name: t.name, input: t.arguments ?? {} });
  return { id: 'msg_' + crypto.randomBytes(6).toString('hex'), type: 'message', role: 'assistant', model: n.model, content,
    stop_reason: a.tool_calls?.length ? 'tool_use' : 'end_turn', stop_sequence: null,
    usage: { input_tokens: inTok, output_tokens: est(a.content || JSON.stringify(a.tool_calls || '')) } };
}
function sse(res, kind, a, n, inTok) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  if (kind === 'openai') {
    const b = openaiBody(a, n, inTok);
    const msg = b.choices[0].message;
    const chunk = (delta, finish = null) => res.write('data: ' + JSON.stringify({ id: b.id, object: 'chat.completion.chunk', created: b.created, model: n.model, choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n');
    chunk({ role: 'assistant', content: '' });
    if (msg.content) for (const piece of msg.content.match(/[\s\S]{1,40}/g) || []) chunk({ content: piece });
    if (msg.tool_calls) chunk({ tool_calls: msg.tool_calls.map((t, i) => ({ index: i, ...t })) });
    chunk({}, b.choices[0].finish_reason);
    res.write('data: ' + JSON.stringify({ id: b.id, object: 'chat.completion.chunk', choices: [], usage: b.usage }) + '\n\n');
    res.end('data: [DONE]\n\n');
    return;
  }
  const b = anthropicBody(a, n, inTok);
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev('message_start', { message: { ...b, content: [], usage: { input_tokens: inTok, output_tokens: 0 } } });
  b.content.forEach((c, i) => {
    if (c.type === 'text') {
      ev('content_block_start', { index: i, content_block: { type: 'text', text: '' } });
      for (const piece of c.text.match(/[\s\S]{1,40}/g) || []) ev('content_block_delta', { index: i, delta: { type: 'text_delta', text: piece } });
    } else {
      ev('content_block_start', { index: i, content_block: { type: 'tool_use', id: c.id, name: c.name, input: {} } });
      ev('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(c.input) } });
    }
    ev('content_block_stop', { index: i });
  });
  ev('message_delta', { delta: { stop_reason: b.stop_reason, stop_sequence: null }, usage: { output_tokens: b.usage.output_tokens } });
  ev('message_stop', {});
  res.end();
}

function embedding(text, dims) {
  const v = [];
  let seed = crypto.createHash('sha256').update(text).digest();
  while (v.length < dims) {
    for (let i = 0; i + 4 <= seed.length && v.length < dims; i += 4) v.push((seed.readUInt32BE(i) / 0xffffffff) * 2 - 1);
    seed = crypto.createHash('sha256').update(seed).digest();
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

// ---------- brain mode (simplat) ----------
const brains = new Map();
async function brainAnswer(modPath, n, meta) {
  let b = brains.get(modPath);
  if (!b) { b = await import(modPath); brains.set(modPath, b); }
  const out = await b.answer(n, { id: meta.id, kind: meta.kind, dir: DIR });
  return out ?? null;
}

let seq = 0;
http.createServer(async (req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  await new Promise((r) => req.on('end', r));
  const url = req.url || '';
  const t0 = Date.now();
  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { /* leave empty */ }
  const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

  if (req.method === 'GET' && url.endsWith('/health')) return send(200, { ok: true });
  if (req.method === 'GET' && /\/models\/?$/.test(url)) return send(200, { data: [{ id: 'standin' }] });
  if (url.includes('/embeddings')) {
    const inputs = Array.isArray(body.input) ? body.input : [body.input ?? ''];
    const dims = body.dimensions || Number(process.env.STANDIN_EMBED_DIMS || 1536);
    log({ kind: 'embeddings', n: inputs.length, dims, ms: 0 });
    return send(200, { object: 'list', model: body.model, data: inputs.map((t, i) => ({ object: 'embedding', index: i, embedding: embedding(String(t), dims) })), usage: { prompt_tokens: est(inputs.join(' ')), total_tokens: est(inputs.join(' ')) } });
  }
  const kind = url.includes('/messages') ? 'anthropic' : url.includes('/chat/completions') ? 'openai' : null;
  if (!kind) { log({ kind: 'unknown', url }); return send(404, { error: { message: 'stand-in: unknown path ' + url } }); }

  const n = normalise(kind, body);
  const id = `${String(++seq).padStart(5, '0')}-${crypto.randomBytes(3).toString('hex')}`;
  const { mode, rule } = pickMode(n);
  const inTok = est(n.system + n.messages.map((m) => m.content).join(''));
  const meta = { id, kind, model: n.model, mode, rule, stream: n.stream, inTok, tools: n.tools.map((t) => t.name), forced: n.forced, schema: !!n.schema,
    caller: (n.system || n.messages[0]?.content || '').replace(/\s+/g, ' ').slice(0, 220), auth: !!(req.headers.authorization || req.headers['x-api-key']), referer: req.headers['http-referer'] || req.headers['x-title'] || null };

  if (mode === 'hang') { log({ ...meta, outcome: 'hang' }); return; }
  if (mode.startsWith('fail')) {
    const status = Number(mode.split(':')[1] || 500);
    log({ ...meta, outcome: 'fail', status });
    return send(status, kind === 'anthropic' ? { type: 'error', error: { type: 'api_error', message: 'stand-in failure ' + status } } : { error: { message: 'stand-in failure ' + status, code: status } });
  }
  let a = null;
  if (mode === 'oracle') {
    const h = promptHash(n);
    const cached = path.join(CACHE, h + '.json');
    if (fs.existsSync(cached)) {
      a = JSON.parse(fs.readFileSync(cached, 'utf8'));
      log({ ...meta, outcome: 'answered', cached: true, ms: Date.now() - t0, outChars: (a.content || JSON.stringify(a.tool_calls || '')).length });
      if (n.stream) return sse(res, kind, a, n, inTok);
      return send(200, kind === 'anthropic' ? anthropicBody(a, n, inTok) : openaiBody(a, n, inTok));
    }
    a = await oracleAnswer(id, kind, n, req);
    if (a) fs.writeFileSync(cached, JSON.stringify(a));
    if (!a) { log({ ...meta, outcome: 'oracle-timeout', ms: Date.now() - t0 }); if (!res.writableEnded) send(503, { error: { message: 'stand-in: oracle timeout' } }); return; }
  } else if (mode.startsWith('canned:')) {
    // FOUNDER-SIM EXTENSION (private copy): a fixed adversarial answer from a file —
    // {"content": "..."} or {"tool_calls":[{"name":..,"arguments":{..}}]}. When the
    // canned tool is not among the tools offered, fall back to script mode and say so.
    try {
      a = JSON.parse(fs.readFileSync(mode.slice(7), 'utf8'));
      // B2 EXTENSION — scripted multi-turn answers (deterministic, realistic):
      //   {"sequence":[a0,a1,…]}  → answer by the number of assistant turns so far
      //   {"cases":[{"match":"…","answer":{…}}], "default":{…}} → first case whose
      //      match is a substring of the FIRST user message (the task + briefing)
      // A sequence entry may itself be {"cases":…}.
      const pickCase = (x) => {
        if (!x || !x.cases) return x;
        const first = (n.messages[0]?.content || '');
        const hit = x.cases.find((c) => first.includes(c.match));
        return hit ? hit.answer : (x.default ?? scriptAnswer(n));
      };
      if (a.sequence) {
        const turns = n.messages.filter((m) => m.role === 'assistant').length;
        a = pickCase(a.sequence[Math.min(turns, a.sequence.length - 1)]);
      } else a = pickCase(a);
      if (a.tool_calls && n.tools.length && !a.tool_calls.every((t) => n.tools.some((x) => x.name === t.name))) {
        a = { ...scriptAnswer(n), cannedSkipped: 'tool not offered: ' + a.tool_calls.map((t) => t.name).join(',') };
      }
    } catch (e) { a = { content: 'canned file unreadable' }; }
  } else if (mode.startsWith('brain:')) {
    try {
      a = await brainAnswer(mode.slice(6), n, meta);
      if (!a) a = { ...scriptAnswer(n), brainSkipped: 'no answer for this call' };
    } catch (e) { a = { ...scriptAnswer(n), brainSkipped: 'brain threw: ' + String(e && e.message || e).slice(0, 200) }; }
    if (a.tool_calls && n.tools.length && !a.tool_calls.every((t) => n.tools.some((x) => x.name === t.name))) {
      a = { ...scriptAnswer(n), brainSkipped: 'tool not offered: ' + a.tool_calls.map((t) => t.name).join(','), attack: a.attack };
    }
  } else a = scriptAnswer(n);
  // SIMPLAT: what the product answered the brain's previous tool calls (refusals included).
  const lastA = n.messages.map((m) => m.role).lastIndexOf('assistant');
  const toolText = mode.startsWith('brain:') && lastA >= 0 ? n.messages.slice(lastA + 1).map((m) => m.content || '').join('\n').slice(0, 800) : undefined;
  log({ ...meta, outcome: 'answered', brain: mode.startsWith('brain:') ? (a.brainSkipped || 'applied') : undefined, attack: a.attack, brainRole: a.role, toolText, ms: Date.now() - t0, outChars: (a.content || JSON.stringify(a.tool_calls || '')).length, canned: mode.startsWith('canned:') ? (a.cannedSkipped || 'applied') : undefined, answeredTools: a.tool_calls ? a.tool_calls.map((t) => t.name) : undefined });
  if (n.stream) return sse(res, kind, a, n, inTok);
  return send(200, kind === 'anthropic' ? anthropicBody(a, n, inTok) : openaiBody(a, n, inTok));
}).listen(PORT, '127.0.0.1', () => console.log(`model stand-in on :${PORT}, dir ${DIR}`));
