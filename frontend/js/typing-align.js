/* ════════════════════════════════════════════════════════════
   SHARED WORD-ALIGNMENT ENGINE
   Used by typing-test.html (result dashboard + comparison) and
   quick-test.html (live scoring + final results).
   Handles: skips, wrong words, missed lines, extra words.
   ════════════════════════════════════════════════════════════ */

// Strip surrounding punctuation/quotes for matching only
function normWord(w) {
  // Comparison normaliser: trim punctuation/symbols at the word edges only.
  // Must be Unicode-aware — an ASCII-only class would erase Devanagari words
  // entirely (Hindi passages rendered blank / all words "equal").
  return String(w||'').replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu,'').toLowerCase();
}

// Classify a match between typed word and original word
function classifyWord(tw, ow) {
  const normTw = normWord(tw), normOw = normWord(ow);
  if (tw === ow)             return 'correct';     // exact match
  if (normTw === normOw)     return 'halfmistake'; // case difference only
  return 'wrong';                                   // anything else = full mistake
}

// ── LCS-BASED ALIGNMENT ──────────────────────────────────────
// Uses Longest Common Subsequence to find optimal word matching.
function doAlignWords(origWords, typedWords) {
  const O = origWords.length;
  const T = typedWords.length;

  // ── Step 1: Build LCS table ─────────────────────────────
  // lcs[i][j] = length of LCS of orig[0..i-1] and typed[0..j-1]
  // Use flat Uint16Array for performance on 500+ word passages
  const lcs = new Uint16Array((O + 1) * (T + 1));
  const idx = (i, j) => i * (T + 1) + j;

  for (let i = 1; i <= O; i++) {
    for (let j = 1; j <= T; j++) {
      if (normWord(origWords[i-1]) === normWord(typedWords[j-1])) {
        lcs[idx(i,j)] = lcs[idx(i-1,j-1)] + 1;
      } else {
        lcs[idx(i,j)] = Math.max(lcs[idx(i-1,j)], lcs[idx(i,j-1)]);
      }
    }
  }

  // ── Step 2: Traceback to get alignment ──────────────────
  // Produces pairs: { oi: origIdx|null, ti: typedIdx|null }
  const alignment = [];
  let i = O, j = T;
  while (i > 0 || j > 0) {
    if (i > 0 && lcs[idx(i-1,j)] === lcs[idx(i,j)]) {
      // Skipping this original word loses no matches — prefer the skip.
      // Traceback runs from the END of the passage, so greedily pairing
      // equal words here would match typed words against far-away repeats
      // of common words ("the", "is", "of"), scattering the alignment and
      // inflating omissions. Skipping-when-free pushes every match to its
      // EARLIEST occurrence, keeping the alignment near what was typed.
      alignment.push({ oi: i-1, ti: null }); // unmatched orig word
      i--;
    } else if (i > 0 && j > 0 && normWord(origWords[i-1]) === normWord(typedWords[j-1])) {
      alignment.push({ oi: i-1, ti: j-1 });
      i--; j--;
    } else if (j > 0 && (i === 0 || lcs[idx(i,j-1)] >= lcs[idx(i-1,j)])) {
      alignment.push({ oi: null, ti: j-1 }); // extra typed word
      j--;
    } else {
      alignment.push({ oi: i-1, ti: null }); // missed orig word
      i--;
    }
  }
  alignment.reverse();

  // ── Step 2b: Merge adjacent gaps into substitution pairs ──
  // LCS only pairs equal words, so a typo ("legall" for "legally") comes out
  // as a missed original PLUS an extra typed word — double-counted. Exam
  // rules treat a mistyped word as ONE full mistake, so pair up unmatched
  // originals with unmatched typed words inside the same gap, in order.
  const merged = [];
  let gapO = [], gapT = [];
  const flushGaps = () => {
    while (gapO.length && gapT.length) merged.push({ oi: gapO.shift(), ti: gapT.shift() });
    while (gapO.length) merged.push({ oi: gapO.shift(), ti: null });
    while (gapT.length) merged.push({ oi: null, ti: gapT.shift() });
  };
  for (const a of alignment) {
    if (a.oi !== null && a.ti !== null) { flushGaps(); merged.push(a); }
    else if (a.oi !== null) gapO.push(a.oi);
    else gapT.push(a.ti);
  }
  flushGaps();
  alignment.length = 0;
  alignment.push(...merged);

  // ── Step 3: Build result slots ───────────────────────────
  const slots = origWords.map(w => ({ orig: w, typed: null, status: 'omitted' }));
  const extra = [];
  let lastPi = 0;

  // Find last matched original index to know how far user got.
  // Raw LCS matches can spuriously extend deep into the passage because
  // common short words ("the", "a", "is") recur throughout the text even
  // though the user only typed a handful of words — cap the "reached"
  // boundary near how many words were actually typed so untouched text
  // is correctly marked 'omitted' rather than 'missed'.
  let lastMatchedOi = -1;
  for (const a of alignment) {
    if (a.oi !== null && a.ti !== null) lastMatchedOi = a.oi;
  }
  lastMatchedOi = Math.min(lastMatchedOi, typedWords.length + 10);

  for (const a of alignment) {
    if (a.oi !== null && a.ti !== null) {
      if (a.oi <= lastMatchedOi) {
        // Genuine matched pair within the range the user actually typed —
        // classify as correct/half/wrong
        const tw = typedWords[a.ti];
        const ow = origWords[a.oi];
        slots[a.oi] = { orig: ow, typed: tw, status: classifyWord(tw, ow) };
        lastPi = a.oi + 1;
      }
      // else: spurious far-flung LCS match (a common word coincidentally
      // matching deep in unread text) — leave as 'omitted'
    } else if (a.oi !== null && a.ti === null) {
      // Original word has no typed match → missed (if within range user typed)
      if (a.oi <= lastMatchedOi) {
        slots[a.oi] = { orig: origWords[a.oi], typed: null, status: 'missed' };
      }
      // else: omitted (user never reached here) — stays as 'omitted'
    } else if (a.oi === null && a.ti !== null) {
      // Typed word has no original match → extra word
      extra.push(typedWords[a.ti]);
    }
  }

  return { slots, extra, lastPi };
}
