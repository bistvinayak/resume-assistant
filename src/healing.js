'use strict';

// Self-healing loop: agents read failure signals and file improvement proposals that an admin
// accepts or rejects in the Admin "Self-healing" tab. Nothing changes without that click.
//
//   thumbs-down chats      → diagnose_chat_feedback  → rule for intent_classify / chat_enrich
//   extension problems     → diagnose_extension_site → rule for map_form_fields, schema field, or ops note
//   (ingestion schema gaps are handled by the existing schema_proposals flow)
//
// Accepted prompt rules are stored in prompt_rules and appended to the prompt at runtime
// (llm.js learnedRules), so each one can be switched off again from the admin.

const {
  getUnanalyzedNegativeFeedback, markFeedbackAnalyzed, getExtensionProblemsBySite, insertProposal,
} = require('./db');
const { diagnoseChatFeedback, diagnoseExtensionSite } = require('./llm');

const CHAT_TARGETS = new Set(['intent_classify', 'chat_enrich']);
const RESOLVED_ERROR = /credits|402|billing/i; // pre-free-model billing failures, already fixed
const AI_PROVIDER_ERROR = /nemotron|gemini|openrouter|:free|overloaded|timed? ?out|timeout|No response from|Cannot read properties|invalid json|Provider returned error|Upstream/i;

function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const week = Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${week}`;
}

async function analyzeChatFeedback() {
  const out = { analyzed: 0, proposed: 0 };
  for (const fb of await getUnanalyzedNegativeFeedback(10)) {
    try {
      const r = await diagnoseChatFeedback(fb);
      out.analyzed++;
      if (r.should_propose && r.rule && CHAT_TARGETS.has(r.target_prompt)) {
        const id = await insertProposal({
          source: 'chat', kind: 'prompt_rule', fingerprint: `chat:${fb.id}`,
          title: String(r.title || 'Disliked chat reply').slice(0, 120), diagnosis: r.diagnosis,
          evidence: { feedback_id: fb.id, chat_mode: fb.chat_mode, user_message: fb.user_message, arjun_reply: fb.arjun_reply, comment: fb.comment, at: fb.created_at },
          target_prompt: r.target_prompt, proposed_rule: r.rule,
        });
        if (id) out.proposed++;
      }
      await markFeedbackAnalyzed(fb.id);
    } catch (e) {
      console.error(`self-healing: chat feedback ${fb.id} analysis failed: ${e.message.slice(0, 160)}`);
    }
  }
  return out;
}

async function analyzeExtension() {
  const out = { sites: 0, proposed: 0 };
  const week = isoWeek();
  for (const site of await getExtensionProblemsBySite(14)) {
    // Label each error's source so the agent can't blame the website for model failures.
    const errors = (site.errors || []).filter(e => !RESOLVED_ERROR.test(e))
      .map(e => ({ source: AI_PROVIDER_ERROR.test(e) ? 'ai_provider' : 'site_or_app', message: e }));
    const billingOnly = site.failed > 0 && !errors.length && !site.slow && !site.low_fill;
    if (billingOnly) continue;
    // Count how often each unfilled label shows up across this site's requests.
    const freq = {};
    for (const list of site.unmapped_lists || []) for (const f of list || []) {
      const k = `${f.label} [${f.type}]`;
      freq[k] = (freq[k] || 0) + 1;
    }
    const unfilled = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([label, count]) => ({ label, count }));
    const payload = { host: site.host, requests: site.total, failed: site.failed, slow_over_30s: site.slow, low_fill: site.low_fill, avg_fill_pct: site.fill_pct, max_fields_on_page: site.max_fields, errors, unfilled_fields: unfilled };
    out.sites++;
    try {
      const r = await diagnoseExtensionSite(payload);
      if (!r.should_propose || !r.rule) continue;
      const kind = ['prompt_rule', 'schema_field', 'ops'].includes(r.kind) ? r.kind : 'ops';
      const id = await insertProposal({
        source: 'extension', kind, fingerprint: `ext:${site.host}:${week}`,
        title: String(r.title || `Problems on ${site.host}`).slice(0, 120), diagnosis: r.diagnosis,
        evidence: payload, target_prompt: kind === 'prompt_rule' ? 'map_form_fields' : null, proposed_rule: r.rule,
      });
      if (id) out.proposed++;
    } catch (e) {
      console.error(`self-healing: extension analysis for ${site.host} failed: ${e.message.slice(0, 160)}`);
    }
  }
  return out;
}

let running = null;
function runSelfHealing() {
  if (running) return running;
  running = (async () => {
    const t0 = Date.now();
    const chat = await analyzeChatFeedback().catch(e => ({ error: e.message }));
    const extension = await analyzeExtension().catch(e => ({ error: e.message }));
    const result = { chat, extension, ms: Date.now() - t0, at: new Date().toISOString() };
    console.log(`✓ self-healing run: ${JSON.stringify(result)}`);
    return result;
  })().finally(() => { running = null; });
  return running;
}

module.exports = { runSelfHealing, isoWeek };
