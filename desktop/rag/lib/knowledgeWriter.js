export const saveKnowledgeCorrectionToolSchema = {
  type: 'function',
  function: {
    name: 'save_knowledge_correction',
    description:
      'Persist a correction to the knowledge base so future questions get it right immediately, without waiting on a manual re-ingest. Use this proactively — without asking permission first — whenever the user tells you a previous answer was wrong and gives you the actual correct information (e.g. pasted real device/CLI output showing the right command or config, a corrected command syntax, or an explicit correction of a fact/procedure). Write clean, focused content capturing the corrected command/fact/procedure and enough context to be useful later — not a raw copy of the chat transcript. After saving, briefly mention to the user that you saved it.',
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'Short topic/title for this correction, used to name the file, e.g. "show-interfaces-flap-syntax" or "dia-no-tag-real-template".',
        },
        content: {
          type: 'string',
          description: 'The corrected content itself, as clean markdown — the actual fact/command/procedure written the way a knowledge base entry should be (a heading, the correct syntax/fact, and a sentence or two of context on when/why it applies), not a chat transcript.',
        },
      },
      required: ['topic', 'content'],
    },
  },
};

// Saves and indexes the correction on the shared knowledge-server (see
// knowledge-server/ in the junos-rag-assistant project) instead of
// writing to a local per-user knowledge folder — so the correction is
// visible to every engineer's app immediately, not just this one.
export async function saveKnowledgeCorrectionTool({ topic, content }) {
  if (!process.env.KNOWLEDGE_API_HOST || !process.env.KNOWLEDGE_API_KEY) {
    return 'Could not save the correction — the shared knowledge base is not configured on this machine (missing KNOWLEDGE_API_HOST/KNOWLEDGE_API_KEY in .env).';
  }
  try {
    const res = await fetch(`${process.env.KNOWLEDGE_API_HOST}/correction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.KNOWLEDGE_API_KEY },
      body: JSON.stringify({ topic, content }),
    });
    if (!res.ok) {
      return `Failed to save correction (${res.status}): ${await res.text()}`;
    }
    const data = await res.json();
    return data.text || 'Correction saved.';
  } catch (err) {
    return `Failed to save correction — could not reach the shared knowledge base: ${err.cause?.message || err.message}`;
  }
}
