// ─── Claude models and per-task settings ─────────────────────────────────────
// Decision #6: Sonnet for the interactive agent and anything the nutritionist
// triggers and waits for; Haiku for background triage and scheduled jobs.
// Every Claude call goes through services/ai/ai.service.js using a TASK below.

const MODELS = Object.freeze({
  interactive: process.env.ANTHROPIC_MODEL            || 'claude-sonnet-5-5',
  background:  process.env.ANTHROPIC_BACKGROUND_MODEL || 'claude-haiku-5-5',
});

// effort: Sonnet 5.5 / Haiku 5.5 use adaptive thinking (always on); effort is
// the only depth control. Starting points per the model guidance: low for
// short generation, medium for clinical analysis and multistep tool use.
// maxTokens counts thinking as well as the visible output.
const TASKS = Object.freeze({
  agent:              { tier: 'interactive', effort: 'medium', maxTokens: 16000 },
  intake_assessment:  { tier: 'interactive', effort: 'medium', maxTokens: 8000 },
  session_insights:   { tier: 'interactive', effort: 'medium', maxTokens: 8000 },
  checkin_message:    { tier: 'interactive', effort: 'low',    maxTokens: 4000 },
  client_summary:     { tier: 'interactive', effort: 'medium', maxTokens: 12000 },
  process_summary:    { tier: 'interactive', effort: 'medium', maxTokens: 8000 },
  protocol_personalize:{ tier: 'interactive', effort: 'medium', maxTokens: 8000 },
  menu_generate:      { tier: 'interactive', effort: 'medium', maxTokens: 16000 },
  // Phase 10: clinical analysis of a session transcript → anamnesis, barriers, draft menu, habits
  session_analysis:   { tier: 'interactive', effort: 'high', maxTokens: 32000 },
  daily_tasks_scan:   { tier: 'interactive', effort: 'low',    maxTokens: 8000 },
  // background
  client_analysis:    { tier: 'background',  effort: 'low',    maxTokens: 4000 },
  morning_brief:      { tier: 'background',  effort: 'medium', maxTokens: 8000 },
  backfill_assessment:{ tier: 'background',  effort: 'medium', maxTokens: 8000 },
  backfill_process_summary: { tier: 'background', effort: 'medium', maxTokens: 8000 },
  backfill_checkin:   { tier: 'background',  effort: 'low',    maxTokens: 4000 },
});

// Kept for code that still reads a single model id
const AI_MODEL = MODELS.interactive;

module.exports = { MODELS, TASKS, AI_MODEL };
