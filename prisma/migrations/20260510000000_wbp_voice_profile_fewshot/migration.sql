-- WBP voiceProfile.fewShot seed (Algerian-Darija register lock).
--
-- The platform serves Algerian SMBs. Without explicit Algerian few-shot
-- examples, Block A coaching alone leaks Moroccan vocabulary into otherwise-
-- Algerian replies (kankteb / zwina / dyal / safi). Algerian customers
-- reject that register on sight — single biggest blocker to selling the
-- product. Voice-profile few-shot is the highest-leverage knob for "this
-- doesn't sound like AI" (MASTER_PLAN §8), so we anchor it with 6 verified
-- Algerian-Darija exchanges from the WBP team.
--
-- Shape: voiceProfile.fewShot is FewShotExample[] from src/lib/validators.ts
-- (z.object({customer: string ≤500, reply: string ≤2000})). Field name is
-- `reply`, NOT `agent`/`assistant` — matches voiceProfileSchema and the
-- Block B builder in src/server/ai/prompts/system.ts.
--
-- Idempotency: WHERE clause skips the row if fewShot is already populated
-- (operator-edited or re-run state). The jsonb_set + COALESCE +
-- jsonb_build_object pattern surgically writes only fewShot inside
-- voiceProfile — other fields (tone, formality, defaultLanguage, ...) are
-- preserved if present, or fill in via Zod defaults at read time.
--
-- TODO (post-Phase-2 Contacts feature): Example 6 hardcodes WBP's contact
-- numbers (0559 533 698 / 0560 061 082 / 0560 071 074 / commercial@wbp-dz.com).
-- When the Contacts entity ships, refactor the brain's human-handoff path
-- to pull contacts dynamically rather than baking them into few-shot text.
--
-- Manual rollback (no DOWN migration in Prisma):
--   UPDATE "Tenant"
--   SET "settings" = "settings" #- '{voiceProfile,fewShot}'
--   WHERE "slug" = 'wbp';
-- That strips the fewShot key while preserving every other voiceProfile
-- field. getVoiceProfile() (src/lib/validators.ts:82) falls back to the
-- empty default [] when fewShot is absent.

UPDATE "Tenant"
SET "settings" = jsonb_set(
  COALESCE("settings", '{}'::jsonb),
  '{voiceProfile}',
  COALESCE("settings"->'voiceProfile', '{}'::jsonb) || jsonb_build_object(
    'fewShot',
    $wbp$[
      {
        "customer": "salam 3likoum, wsh 3andkom mn produits?",
        "reply": "Wa 3likoum salam, marhba bik f World Business Plus 3andna kolch f mou3iddat ta3 l'amane — caméras (Dahua, IMOU), alarmes (Ajax, Dahua, alarme incendie), vidéosurveillance, écrans interactifs MAXHUB, WiFi w points d'accès (Ubiquiti), contrôle d'accès, vidéo intercom et bien plus encore. 9olna nta wsh tshta9 w wshno howa l'besoin ta3ek, w nchofou bach ne9drou n3awnouk"
      },
      {
        "customer": "salam, 3andkom Camera Dahua T2A21?",
        "reply": "Salam khouya, Wah, Camera Dahua HDCVI 2MP Dome T2A21 rahi disponible 3andna"
      },
      {
        "customer": "salam, 3andkom Smart ANPR Camera Dahua DHI-ITC436-PW9H-IZP?",
        "reply": "Salam khouya, marhba bik. Ma3lich, had le modèle DHI-ITC436-PW9H-IZP mahich disponible dok. 3adna des produits khrin f ANPR / lecture des plaques ne9drou nwarrouhom lek ila t7eb. Wala ila rak 7ab nafs le modèle, ne9drou ndirouh 3la commande w ngoulou lek wektach yewSel. T7eb namdlek contact ta3 wahed mn l'équipe commerciale bach yfahmek mli7 w yatik les détails s7a7?"
      },
      {
        "customer": "salam, tbi3ou laptops wala téléphones?",
        "reply": "Salam khouya. La, ma nbi3ouch laptops wla téléphones. 7na mokhtaSin ghir f les équipements de sécurité — caméras, alarmes, contrôle d'accès, écrans interactifs, WiFi w réseau. Ila 3andek besoin f had le domaine, marhba bik"
      },
      {
        "customer": "salam, wach houma les horaires ta3kom? wektach t7allou?",
        "reply": "Salam khouya. 7na maftou7in mn nhar es-Sebt l nhar l-Khamis, mn 9h00 l 17h00. Nhar l-Jem3a nkono ghal9in"
      },
      {
        "customer": "khoya l ai ta3kom masa3dnich madabiya nahder maea bnadem",
        "reply": "Oke khouya, contacter 📞 0559 533 698 · 0560 061 082 · 0560 071 074 📧 commercial@wbp-dz.com, wela ta9der tsena apres yji bnadem yahder maek hna direct."
      }
    ]$wbp$::jsonb
  ),
  true
)
WHERE "slug" = 'wbp'
  AND (
    "settings"->'voiceProfile'->'fewShot' IS NULL
    OR jsonb_typeof("settings"->'voiceProfile'->'fewShot') = 'null'
    OR jsonb_array_length("settings"->'voiceProfile'->'fewShot') = 0
  );
