'use strict';
// Scans string literals in the top-level *.js files for command-style owner copy (see ownerCopyStyle.test.js).
const fs = require('node:fs'), path = require('node:path');
const profile = require('../../agentProfile');

const ROOT = path.join(__dirname, '..', '..');
const PLURAL = /(?:^|[^א-ת])(?:כתבו|שלחו|לחצו)(?![א-ת])/;

// Explicit, small allowlist. Each entry: file + a substring of the literal + why.
const ALLOW = [
  // Exact approval codes ("שלח: אשר 123456") need no entry: agentProfile.COMMAND already allows them.
  // Everything below is addressed to the business's customers (ads, posts, replies to leads), not to
  // the owner, so plural is correct Hebrew there.
  { file: 'catalog.js', has: 'שלחו הודעה', why: 'ad / post copy for customers' },
  { file: 'organicContent.js', has: 'שלחו לנו הודעה', why: 'post copy for customers' },
  { file: 'organicContent.js', has: 'כתבו לנו', why: 'post copy for customers' },
  { file: 'organicContent.js', has: 'שלחו הודעה', why: 'post copy for customers' },
  { file: 'creativeRevision.js', has: 'שלחו הודעה', why: 'ad CTA for customers' },
  { file: 'socialContent.js', has: 'שלחו הודעה', why: 'post CTA for customers' },
  { file: 'expertPlaybook.js', has: 'שלחו הודעה', why: 'model guidance about customer-facing CTAs' },
  { file: 'taskEvaluation.js', has: 'כתבו לנו', why: 'customer-facing sample ad copy' },
  { file: 'leadConcierge.js', has: 'הסר', why: 'opt-out instruction to leads (legal requirement)' },
  { file: 'leadConcierge.js', has: 'כתבו כאן', why: 'reply to a lead' },
  { file: 'growth.js', has: 'כתבו ״הסר״', why: "opt-out line in messages to the owner's customers (legal requirement)" },
];

// Minimal JS tokenizer: yields the text of every string literal (template quasis joined with "X").
function literals(src) {
  const out = []; let i = 0; let prev = '';
  const isRegexStart = () => !prev || /[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || /\b(?:return|typeof|case|in|of)$/.test(prev);
  function readTemplate() { // at the char after `
    let s = '';
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { s += src.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { i++; return s; }
      if (c === '$' && src[i + 1] === '{') { i += 2; scan('}'); s += 'X'; continue; }
      s += c; i++;
    }
    return s;
  }
  function scan(end) {
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (end && c === '{') depth++;
      if (end && c === '}') { if (depth === 0) { i++; prev = 'X'; return; } depth--; }
      if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
      if (c === '"' || c === "'") {
        let j = i + 1, s = '';
        while (j < src.length && src[j] !== c) { if (src[j] === '\\') { s += src.slice(j, j + 2); j += 2; } else s += src[j++]; }
        out.push(s); i = j + 1; prev = 'X'; continue;
      }
      if (c === '`') { i++; out.push(readTemplate()); prev = 'X'; continue; }
      if (c === '/' && isRegexStart()) {
        let j = i + 1, cls = false;
        while (j < src.length && src[j] !== '\n') { if (src[j] === '\\') { j += 2; continue; } if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break; j++; }
        i = j + 1; while (/[a-z]/i.test(src[i] || '')) i++; prev = 'X'; continue;
      }
      if (!/\s/.test(c)) prev = (prev + c).slice(-12); i++;
    }
  }
  scan(null);
  return out;
}

function violations() {
  const bad = [];
  for (const file of fs.readdirSync(ROOT).filter((f) => f.endsWith('.js')).sort()) {
    for (const text of literals(fs.readFileSync(path.join(ROOT, file), 'utf8'))) {
      if (!/[א-ת]/.test(text)) continue;
      const command = profile.COMMAND.test(text), plural = PLURAL.test(text);
      if (!command && !plural) continue;
      if (ALLOW.some((a) => a.file === file && text.includes(a.has))) continue;
      bad.push(`${file}: ${command ? 'COMMAND' : 'PLURAL'}: ${text.slice(0, 140)}`);
    }
  }
  return bad;
}

module.exports = { literals, violations, ALLOW };
