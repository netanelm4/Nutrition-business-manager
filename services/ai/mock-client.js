// ─── Deterministic stand-in for the Anthropic client (AI_MOCK=1, tests only) ─
// parse():  builds a sample object from the request's JSON schema and validates
//           it with the same format.parse() the real SDK uses — so schema bugs
//           still surface in tests.
// create(): returns a short Hebrew text.
// stream(): agent turns. A user message containing directives
//             #tool:<name> {json input}
//           makes the mock answer with those tool_use blocks; after the tool
//           results come back it answers with text that quotes them.

function sampleFromSchema(schema, root = schema) {
  if (!schema) return null;
  if (schema.$ref) {                       // "#/$defs/__schema0" — zod emits these for reused schemas
    const name = schema.$ref.split('/').pop();
    return sampleFromSchema({ ...root.$defs?.[name], description: schema.description }, root);
  }
  if (schema.anyOf) return sampleFromSchema(schema.anyOf.find((s) => s.type !== 'null') || schema.anyOf[0], root);
  switch (schema.type) {
    case 'object': {
      const out = {};
      for (const [key, prop] of Object.entries(schema.properties || {})) out[key] = sampleFromSchema(prop, root);
      return out;
    }
    case 'array':   return [sampleFromSchema(schema.items, root)];
    case 'integer': return 1;
    case 'number':  return 1;
    case 'boolean': return true;
    case 'null':    return null;
    case 'string': {
      const m = /enum: \[(.*?)\]/.exec(schema.description || '');
      if (m) return JSON.parse(`[${m[1]}]`)[0];
      return 'טקסט לדוגמה';
    }
    default: return null;
  }
}

const usage = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0 };

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return { text: m.content, isToolResult: false };
    const toolResults = m.content.filter((b) => b.type === 'tool_result');
    if (toolResults.length) return { text: null, isToolResult: true, toolResults };
    return { text: m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'), isToolResult: false };
  }
  return { text: '', isToolResult: false };
}

let toolCounter = 0;
function agentResponse(params) {
  const last = lastUserText(params.messages);
  if (!last.isToolResult) {
    const directives = [...(last.text || '').matchAll(/#tool:(\w+)\s*(\{.*?\})?(?=\s*(?:#tool:|$))/gm)];
    if (directives.length) {
      return {
        role: 'assistant', model: params.model, stop_reason: 'tool_use', usage,
        content: [
          { type: 'thinking', thinking: '', signature: 'mock' },
          ...directives.map(([, name, json]) => ({
            type: 'tool_use', id: `toolu_mock_${++toolCounter}`, name, input: json ? JSON.parse(json) : {},
          })),
        ],
      };
    }
    return { role: 'assistant', model: params.model, stop_reason: 'end_turn', usage,
      content: [{ type: 'text', text: 'שלום, איך אפשר לעזור?' }] };
  }
  const summary = last.toolResults.map((r) => {
    const c = typeof r.content === 'string' ? r.content : JSON.stringify(r.content);
    return `${r.is_error ? 'שגיאה' : 'תוצאה'}: ${c.slice(0, 160)}`;
  }).join('\n');
  return { role: 'assistant', model: params.model, stop_reason: 'end_turn', usage,
    content: [{ type: 'text', text: `סיכום הפעולות:\n${summary}` }] };
}

function makeStream(message) {
  const events = [];
  message.content.forEach((block, index) => {
    if (block.type === 'text') {
      for (const chunk of block.text.match(/.{1,40}/gs) || []) {
        events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: chunk } });
      }
    }
  });
  return {
    async *[Symbol.asyncIterator]() { for (const e of events) yield e; },
    finalMessage: async () => message,
    abort: () => {},
  };
}

function createMockClient() {
  const messages = {
    create: async (params) => ({
      role: 'assistant', model: params.model, stop_reason: 'end_turn', usage,
      content: [{ type: 'text', text: 'טקסט לדוגמה' }],
    }),
    parse: async (params) => {
      // optional simulated latency for tests of in-flight states (AI_MOCK only)
      const delay = Number(process.env.AI_MOCK_DELAY_MS) || 0;
      if (delay) await new Promise((r) => setTimeout(r, delay));
      const format = params.output_config?.format;
      const sample = sampleFromSchema(format?.schema);
      const text = JSON.stringify(sample);
      return {
        role: 'assistant', model: params.model, stop_reason: 'end_turn', usage,
        content: [{ type: 'text', text }],
        parsed_output: format?.parse ? format.parse(text) : sample,
      };
    },
    stream: (params) => makeStream(agentResponse(params)),
  };
  return { beta: { messages }, messages };
}

module.exports = { createMockClient, sampleFromSchema };
