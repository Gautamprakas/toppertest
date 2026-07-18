-- Devanagari numerals (०-९) in Hindi passages forced typists to use the
-- Devanagari number row; most enter numbers via the English layout/numpad,
-- which the scorer counted as a full mistake. Convert to ASCII digits in
-- all stored Hindi passages; the scraper does the same for new ones.
UPDATE passages
SET passage_text =
  REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
  REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    passage_text,
    '०','0'),'१','1'),'२','2'),'३','3'),'४','4'),
    '५','5'),'६','6'),'७','7'),'८','8'),'९','9')
WHERE language = 'hindi';
