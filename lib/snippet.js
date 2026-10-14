/**
 * lib/snippet.js
 *
 * A short excerpt of page text around a match, for run summaries. The cut
 * points move out to whole words so the excerpt never starts or ends mid-word
 * ("ssed. You will..."), and the start moves up to a sentence that begins
 * before the match; a cut end is marked with "...".
 */

function snippetAround(text, index, before, after) {
  let start = Math.max(0, index - before);
  let end = Math.min(text.length, index + after);
  if (start > 0 && /\S/.test(text[start - 1])) {
    const ws = text.slice(0, start).search(/\s\S*$/);
    start = ws === -1 ? 0 : ws;
  }
  if (end < text.length && /\S/.test(text[end])) {
    const ws = text.slice(end).search(/\s/);
    end = ws === -1 ? text.length : end + ws;
  }
  const lead = text.slice(start, index).match(/^[\s\S]*[.!?]\s+/);
  if (lead) start += lead[0].length;
  const body = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '... ' : '') + body + (end < text.length ? ' ...' : '');
}

module.exports = { snippetAround };
