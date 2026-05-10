-- WBP voiceProfile.fewShot example 6 rewrite — remove hardcoded contacts.
--
-- The original 20260510000000_wbp_voice_profile_fewshot migration baked
-- specific WBP phone numbers and the commercial@wbp-dz.com email into the
-- example-6 agent reply. That's load-bearing few-shot text, so any
-- change in WBP's contacts (a phone swap, an email rotation, an
-- additional channel) would silently rot the prompt.
--
-- The new Contact model + dynamic Block C injection (CONTACT INFO
-- citations, cap MAX_CONTACTS_IN_PROMPT) makes the few-shot guidance
-- contact-agnostic: the example teaches the register / handoff
-- structure, and the brain interpolates the actual contacts from
-- citations at runtime.
--
-- Idempotency: jsonb_set targets just the array index for example 6
-- (zero-indexed: position 5). Re-running yields the same final state.
-- WHERE-clause guard: only proceed if (a) WBP exists, (b) fewShot has
-- at least 6 entries, and (c) the 6th customer line matches the
-- original handoff prompt — that way we don't clobber a divergent
-- state introduced by an operator-side edit between commits.
--
-- Manual rollback: copy the original example-6 reply back from the
-- 20260510000000 migration file and run an inverse jsonb_set.

UPDATE "Tenant"
SET "settings" = jsonb_set(
  "settings",
  '{voiceProfile,fewShot,5}',
  $wbp$
  {
    "customer": "khoya l ai ta3kom masa3dnich madabiya nahder maea bnadem",
    "reply": "Oke khouya, hada les contacts ta3 l'équipe commerciale (rahom f les citations f3a9, weldy n9oulhom lek): rana ne9der nfawatlek wahed mn l'équipe direct. Wala ta9der tsena hna apres yji bnadem yahder maek direct."
  }
  $wbp$::jsonb
)
WHERE "slug" = 'wbp'
  AND jsonb_typeof("settings"->'voiceProfile'->'fewShot') = 'array'
  AND jsonb_array_length("settings"->'voiceProfile'->'fewShot') >= 6
  AND "settings"->'voiceProfile'->'fewShot'->5->>'customer' = 'khoya l ai ta3kom masa3dnich madabiya nahder maea bnadem';
