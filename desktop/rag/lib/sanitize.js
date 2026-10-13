/**
 * Utility functions for sanitizing input strings before injecting them into
 * LLM system prompts and XML-bounded user message blocks.
 */

/**
 * Escapes XML/HTML boundary characters to prevent tag breakout attacks.
 * Converts `<`, `>`, `&`, `"`, and `'` into their corresponding HTML entities.
 *
 * @param {string} text - The raw untrusted string input.
 * @returns {string} - The safely escaped string.
 */
export function escapeXml(text) {
  if (typeof text !== 'string') {
    if (text === null || text === undefined) return '';
    return String(text);
  }

  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Completely strips XML/HTML tags from the string.
 *
 * @param {string} text - The raw untrusted string input.
 * @returns {string} - Cleaned text without XML tags.
 */
export function stripXmlTags(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/<\/?[^>]+(>|$)/g, '');
}

/**
 * Comprehensive input sanitizer for LLM prompt insertion.
 * - Truncates excessive string lengths to mitigate context window stuffing attacks.
 * - Strips non-printable ASCII control characters.
 * - Escapes or strips XML delimiters to prevent system policy breakouts.
 *
 * @param {string} text - Raw input from user, knowledge base, or CLI tool.
 * @param {Object} [options]
 * @param {boolean} [options.stripTags=false] - If true, strips tags completely instead of escaping.
 * @param {number} [options.maxLength=10000] - Hard cap on string length.
 * @returns {string} - Safe string ready for prompt template insertion.
 */
export function sanitizeForPrompt(text, { stripTags = false, maxLength = 10000 } = {}) {
  if (typeof text !== 'string') {
    if (text === null || text === undefined) return '';
    text = String(text);
  }

  // 1. Truncate to prevent context window stuffing attacks
  let cleaned = text.slice(0, maxLength);

  // 2. Remove invisible control characters (ASCII 0-8, 11-12, 14-31, 127)
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // 3. Either strip or escape XML boundary tags
  return stripTags ? stripXmlTags(cleaned) : escapeXml(cleaned);
}