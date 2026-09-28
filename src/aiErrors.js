// Turns raw AI provider failures into messages a user can act on.
//
// Arjun runs on OpenRouter's free models, which rate-limit per minute and get overloaded at busy
// times; users should hear that plainly instead of "429 free-models-per-min". Jev (job fit) is a
// separate paid service, so its slowness gets its own message.

const FREE_MODEL_BUSY = "Arjun runs on free AI models, and they're busy right now because many people are using them, so this can be slow or fail. Please try again in a minute.";
const FREE_MODEL_WAITING = "The free AI models are busy right now. Arjun keeps trying in the background, and your resume will appear in My Applications as soon as it's ready. You don't need to do anything.";
const FIT_SERVICE_BUSY = 'The job-fit service is slow to respond right now. Please try again in a minute.';

const JEV = /jev_|typesafe/i;
const FREE_MODEL = /\b429\b|rate.?limit|free-models|overloaded|temporarily|upstream|no response from|timed? ?out|timeout|provider returned error|\b50[234]\b|ECONNRESET|socket hang up/i;

function friendlyAiError(message) {
  const m = String(message || '');
  if (JEV.test(m)) return /timeout|aborted|429|529|50[234]/i.test(m) ? { code: 'fit_busy', message: FIT_SERVICE_BUSY } : null;
  if (FREE_MODEL.test(m)) return { code: 'ai_busy', message: FREE_MODEL_BUSY };
  return null;
}

module.exports = { friendlyAiError, FREE_MODEL_BUSY, FREE_MODEL_WAITING, FIT_SERVICE_BUSY };
