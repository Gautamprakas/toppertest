-- Login by mobile number requires phone to identify exactly one account.
-- Normalize empties, null out any duplicate phones (keeping the oldest
-- account), then enforce uniqueness. NULLs are allowed and not unique.
UPDATE users SET phone = NULL WHERE phone = '';

UPDATE users u
JOIN (
  SELECT phone, MIN(id) AS keep_id
  FROM users WHERE phone IS NOT NULL
  GROUP BY phone HAVING COUNT(*) > 1
) d ON u.phone = d.phone AND u.id <> d.keep_id
SET u.phone = NULL;

ALTER TABLE users ADD UNIQUE INDEX idx_phone_unique (phone);
