/**
 * Daily job: generates 5-6 typing-test passages per exam, per language that
 * exam supports, spanning Easy/Medium/Hard difficulty. Content is sourced
 * from Wikipedia's public MediaWiki API (random articles + lead-section
 * extracts) — see .claude/plans plan doc for why (PIB scraping was tried and
 * is blocked by Akamai for cloud/datacenter IPs, which includes this server).
 *
 * Run manually:  node scripts/scrape-daily-passages.js
 * Run via cron:  see README/plan for the crontab entry.
 */
const db = require('../config/db');

const PASSAGES_PER_BATCH = 6;
const TITLES_PER_ROUND = 20;
const MAX_ROUNDS_PER_BATCH = 5;
const REQUEST_DELAY_MS = 500;
const USER_AGENT = 'TopperTest-DailyPassages/1.0 (https://toppertest.com)';

const WIKI_HOST = { hindi: 'hi.wikipedia.org', english: 'en.wikipedia.org' };

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ── Text cleaning ──────────────────────────────────────────────────────────
 * Wikipedia's explaintext extracts contain content a typist cannot produce on
 * an exam keyboard: "== section headings ==", IPA pronunciations, math like
 * {\displaystyle}, URLs, curly quotes, degree/prime marks, and (for Hindi
 * articles) embedded Latin-script asides. All of it must go — it breaks the
 * word-match scoring and inflates word counts past the real typeable length.
 */

// Characters a typist can produce: per-language script + shared punctuation.
const COMMON_CHARS = '0-9 \\t.,;:\'"!?()\\-%/';
const DISALLOWED = {
  english: new RegExp(`[^A-Za-z${COMMON_CHARS}]`, 'g'),
  hindi:   new RegExp(`[^\\u0900-\\u097F${COMMON_CHARS}]`, 'g'), // Devanagari incl. ।॥ and ०-९
};

function cleanText(raw, language) {
  let t = raw
    .replace(/==+[^=\n]*==+/g, ' ')        // "== Section ==" heading markers
    .replace(/\{[^{}]*\}/g, ' ')           // {\displaystyle ...} math fragments
    .replace(/https?:\/\/\S+/g, ' ')       // bare URLs (reference sections)
    .replace(/[“”«»„]/g, '"')              // normalize typographic quotes
    .replace(/[‘’‚]/g, "'")
    .replace(/[–—―]/g, '-')                // normalize dashes
    .replace(/[′″]/g, "'")
    // Devanagari numerals -> ASCII digits (१९९२ -> 1992) so Hindi passages
    // never require the Devanagari number row; most typists enter numbers
    // with the English layout or numpad.
    .replace(/[०-९]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x0966 + 48));

  // Strip anything the exam keyboard can't type (IPA, foreign script,
  // symbols, zero-width joiners...). Replace with a space, then tidy up.
  t = t.replace(DISALLOWED[language], ' ');

  t = t
    .replace(/\(\s*[.,;:'"!?%\/\-\s]*\)/g, ' ')  // parens left holding only punctuation
    .replace(/\(([^()]*[:;])\s*\)/g, ' ')        // parens ending in a bare label, e.g. "(अंग्रेज़ी:)"
    .replace(/"\s*"/g, ' ')                       // emptied quote pairs
    .replace(/\s+([.,;:!?।])/g, '$1')             // no space before punctuation
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/([.,;:!?।])\1+/g, '$1')             // collapse repeated punctuation
    .replace(/\s+/g, ' ')
    .trim();

  // Sentence-level pass: drop tiny fragments left over from heavy cleaning
  // (e.g. an orphaned "s." after a stripped foreign phrase).
  const sentences = t.split(/(?<=[।.!?])\s+/).filter(s => countWords(s) >= 4);
  return sentences.join(' ');
}

function complexityScore(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const sentences = text.split(/[।.!?]+/).map(s => s.trim()).filter(Boolean);
  const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / words.length;
  const avgSentenceLength = words.length / Math.max(sentences.length, 1);
  return avgWordLength * 0.6 + avgSentenceLength * 0.1;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } });
  if (!res.ok) return null;
  return res.json();
}

async function fetchRandomTitles(language, count) {
  const url = `https://${WIKI_HOST[language]}/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=${count}&format=json`;
  const data = await fetchJson(url);
  return (data?.query?.random || []).map(r => r.title);
}

// MediaWiki's TextExtracts API only returns a non-intro (full-body) extract
// for one title per request, no matter how many titles are passed — so full
// articles have to be fetched one at a time. Cheap intro-only extracts (used
// just to weed out obvious stubs before spending a full-article request on
// them) can still be batched.
async function fetchIntroExtracts(language, titles) {
  if (!titles.length) return {};
  const titlesParam = titles.map(encodeURIComponent).join('|');
  const url = `https://${WIKI_HOST[language]}/w/api.php?action=query&prop=extracts&exintro&explaintext&titles=${titlesParam}&format=json`;
  const data = await fetchJson(url);
  const pages = data?.query?.pages || {};
  const extracts = {};
  for (const id in pages) {
    if (pages[id].extract) extracts[pages[id].title] = pages[id].extract;
  }
  return extracts;
}

async function fetchFullExtract(language, title) {
  const url = `https://${WIKI_HOST[language]}/w/api.php?action=query&prop=extracts&explaintext&titles=${encodeURIComponent(title)}&format=json`;
  const data = await fetchJson(url);
  const pages = data?.query?.pages || {};
  for (const id in pages) {
    if (pages[id].extract) return pages[id].extract;
  }
  return null;
}

// Cuts the full article text down to the first sentence boundary at or past
// minWords, rather than inserting an entire (sometimes 5000+ word) article as
// a single "typing passage" — keeps it a natural, practically-sized passage
// while still guaranteeing at least minWords.
function truncateAtSentence(text, minWords) {
  const sentences = text.split(/(?<=[।.!?])\s+/);
  let result = '';
  let wc = 0;
  for (const sentence of sentences) {
    result += (result ? ' ' : '') + sentence;
    wc += countWords(sentence);
    if (wc >= minWords) break;
  }
  return { text: result, wordCount: wc };
}

async function collectCandidates(language, needed, minWords) {
  const candidates = [];
  let round = 0;
  while (candidates.length < needed && round < MAX_ROUNDS_PER_BATCH) {
    round++;
    try {
      const titles = await fetchRandomTitles(language, TITLES_PER_ROUND);
      await sleep(REQUEST_DELAY_MS);
      // Weed out obvious stubs cheaply before spending a full-article fetch
      const intros = await fetchIntroExtracts(language, titles);
      await sleep(REQUEST_DELAY_MS);

      for (const title in intros) {
        if (candidates.length >= needed) break;
        if (countWords(intros[title]) < 20) continue; // near-empty stub, skip

        const full = await fetchFullExtract(language, title);
        await sleep(REQUEST_DELAY_MS);
        if (!full) continue;

        // Articles that lose too much content to cleaning are math/table/
        // list-heavy — the surviving text reads badly, so skip them entirely.
        const cleaned = cleanText(full, language);
        if (cleaned.length < full.length * 0.6) continue;

        // Word counts are measured on CLEANED text only, so the stored
        // word_count reflects genuinely typeable words.
        if (countWords(cleaned) < minWords) continue;

        const { text, wordCount } = truncateAtSentence(cleaned, minWords);
        if (wordCount < minWords) continue; // safety: never insert short passages
        candidates.push({ title, text, wordCount, score: complexityScore(text) });
      }
    } catch (err) {
      console.error(`  fetch error (${language}):`, err.message);
    }
  }
  return candidates;
}

function bucketByDifficulty(candidates) {
  const sorted = [...candidates].sort((a, b) => a.score - b.score);
  const third = Math.ceil(sorted.length / 3);
  return sorted.map((c, i) => ({
    ...c,
    difficulty: i < third ? 'E' : i < third * 2 ? 'M' : 'H'
  }));
}

async function insertPassages(examId, language, passages, today) {
  for (const p of passages) {
    await db.query(
      `INSERT INTO passages (exam_id, passage_text, language, difficulty, passage_date, word_count, title)
       VALUES (?,?,?,?,?,?,?)`,
      [examId, p.text, language, p.difficulty, today, p.wordCount, p.title]
    );
  }
}

async function runBatch(exam, language, today) {
  const label = `${exam.exam_name} / ${language} (word_limit ${exam.word_limit})`;
  const candidates = await collectCandidates(language, PASSAGES_PER_BATCH, exam.word_limit);
  if (candidates.length < PASSAGES_PER_BATCH) {
    console.warn(`  ⚠ ${label}: only found ${candidates.length}/${PASSAGES_PER_BATCH} qualifying articles`);
  }
  if (candidates.length === 0) {
    console.warn(`  ✗ ${label}: skipped, no qualifying articles`);
    return 0;
  }
  const withDifficulty = bucketByDifficulty(candidates);
  await insertPassages(exam.id, language, withDifficulty, today);
  console.log(`  ✓ ${label}: inserted ${withDifficulty.length} passages`);
  return withDifficulty.length;
}

// Pick one of today's fresh Medium passages as the site-wide Daily Challenge,
// rotating which exam supplies it by day-of-year. INSERT IGNORE + the UNIQUE
// challenge_date constraint make this idempotent across re-runs.
async function pickDailyChallenge(exams, today) {
  if (!exams.length) return;
  const dayOfYear = Math.floor((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 86400000);
  const exam = exams[dayOfYear % exams.length];
  const [rows] = await db.query(
    `SELECT id FROM passages
     WHERE exam_id = ? AND passage_date = ? AND is_active = 1
     ORDER BY (difficulty = 'M') DESC, id ASC LIMIT 1`,
    [exam.id, today]
  );
  if (!rows.length) {
    console.warn('  ⚠ Daily challenge: no passage available for', exam.exam_name);
    return;
  }
  const [result] = await db.query(
    'INSERT IGNORE INTO daily_challenges (passage_id, challenge_date) VALUES (?, ?)',
    [rows[0].id, today]
  );
  console.log(result.affectedRows
    ? `  ✓ Daily challenge set: ${exam.exam_name} passage ${rows[0].id}`
    : '  • Daily challenge already set for today');
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`Daily passage generation — ${today}`);

  const [exams] = await db.query('SELECT id, exam_name, language, word_limit FROM exams WHERE is_active = 1');
  let totalInserted = 0;

  for (const exam of exams) {
    const languages = exam.language === 'both' ? ['hindi', 'english'] : [exam.language];
    for (const language of languages) {
      totalInserted += await runBatch(exam, language, today);
    }
  }

  await pickDailyChallenge(exams, today);

  console.log(`Done. ${totalInserted} passages inserted across ${exams.length} exams.`);
  await db.end();
}

if (require.main === module) {
  main().catch(async err => {
    console.error('Fatal error in daily passage generation:', err);
    await db.end();
    process.exit(1);
  });
} else {
  // Exported for testing (cleanText quality checks) without running the job
  module.exports = { cleanText, countWords, truncateAtSentence, complexityScore, fetchFullExtract, fetchRandomTitles };
}
