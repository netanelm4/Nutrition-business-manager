const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { betaZodOutputFormat } = require('@anthropic-ai/sdk/helpers/beta/zod');
const { MODELS, TASKS } = require('../../config/ai');

// ─── The single Claude client and request builder ────────────────────────────
// Every Claude call in the CRM goes through this module:
//   generateText()        free text (rarely needed)
//   generateStructured()  JSON validated against a zod schema (structured outputs)
//   getClient()/requestParams()  for the streaming agent loop
// Settings per task live in config/ai.js. AI_MOCK=1 swaps in a deterministic
// local client for tests (never set in production).

// Server-side refusal fallback (Claude API, Sonnet 5.5 "default" form): a
// declined request is re-run on a fallback model inside the same call.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const FALLBACK_MODELS = new Set(['claude-sonnet-5-5']);

let _client = null;
function getClient() {
  if (_client) return _client;
  if (process.env.AI_MOCK === '1') {
    _client = require('./mock-client').createMockClient();
  } else {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

const VOICE = fs.readFileSync(path.join(__dirname, '..', '..', 'prompts', 'voice.md'), 'utf8');

/** Append the client-facing voice rules (prompts/voice.md) to a system prompt. */
function withVoice(system) {
  return `${system.trim()}\n\n${VOICE}`;
}

class AIRefusalError extends Error {
  constructor(category, explanation) {
    super(`Claude declined the request${category ? ` (${category})` : ''}.`);
    this.name = 'AIRefusalError';
    this.category = category || null;
    this.explanation = explanation || null;
    this.status = 422;
  }
}

class AIOutputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AIOutputError';
    this.status = 502;
  }
}

function taskConfig(task) {
  const cfg = TASKS[task];
  if (!cfg) throw new Error(`Unknown AI task "${task}" (config/ai.js)`);
  return { ...cfg, model: MODELS[cfg.tier] };
}

/**
 * Common request fields for a task: model, max_tokens, effort and — on models
 * that support it — the server-side refusal fallback.
 */
function requestParams(task, { maxTokens, format } = {}) {
  const cfg = taskConfig(task);
  const params = {
    model: cfg.model,
    max_tokens: maxTokens || cfg.maxTokens,
    output_config: { effort: cfg.effort, ...(format ? { format } : {}) },
  };
  if (FALLBACK_MODELS.has(cfg.model) && process.env.AI_FALLBACKS !== 'off') {
    params.betas = [FALLBACK_BETA];
    params.fallbacks = 'default';
  }
  return params;
}

function logUsage(task, response) {
  const u = response?.usage || {};
  console.log(`[ai] ${task} model=${response?.model} stop=${response?.stop_reason} in=${u.input_tokens ?? '?'} out=${u.output_tokens ?? '?'} cache_read=${u.cache_read_input_tokens ?? 0}`);
}

/** Throw on refusal / truncation before anyone reads the content. */
function assertUsable(task, response) {
  if (response.stop_reason === 'refusal') {
    throw new AIRefusalError(response.stop_details?.category, response.stop_details?.explanation);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new AIOutputError(`AI output for ${task} was cut off (max_tokens).`);
  }
}

function toMessages({ prompt, messages }) {
  if (messages) return messages;
  return [{ role: 'user', content: prompt }];
}

/** Free text: the concatenated text blocks (thinking blocks are skipped by type). */
async function generateText({ task, system, prompt, messages, maxTokens }) {
  const response = await getClient().beta.messages.create({
    ...requestParams(task, { maxTokens }),
    ...(system ? { system } : {}),
    messages: toMessages({ prompt, messages }),
  });
  logUsage(task, response);
  assertUsable(task, response);
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

/**
 * Structured output validated against a zod schema. Returns the parsed object.
 * @throws AIRefusalError | AIOutputError
 */
// Above this budget the SDK refuses a non-streaming request ("may take longer
// than 10 minutes"), so long tasks (e.g. session_analysis) are streamed.
const STREAM_ABOVE_TOKENS = 16000;

async function generateStructured({ task, system, prompt, messages, schema, maxTokens }) {
  const format = betaZodOutputFormat(schema);
  const params = {
    ...requestParams(task, { maxTokens, format }),
    ...(system ? { system } : {}),
    messages: toMessages({ prompt, messages }),
  };

  if (params.max_tokens > STREAM_ABOVE_TOKENS && process.env.AI_MOCK !== '1') {
    const response = await getClient().beta.messages.stream(params).finalMessage();
    logUsage(task, response);
    assertUsable(task, response);
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    try {
      return format.parse(text); // same zod validation as messages.parse()
    } catch (err) {
      throw new AIOutputError(`AI output for ${task} did not match its schema: ${err.message}`);
    }
  }

  const response = await getClient().beta.messages.parse(params);
  logUsage(task, response);
  assertUsable(task, response);
  if (response.parsed_output == null) {
    throw new AIOutputError(`AI output for ${task} did not match its schema.`);
  }
  return response.parsed_output;
}

module.exports = {
  getClient,
  requestParams,
  generateText,
  generateStructured,
  withVoice,
  logUsage,
  assertUsable,
  AIRefusalError,
  AIOutputError,
};
