-- Additive-nullable: streak length + detected coding agents (names).
-- Old (<=0.3.1) clients don't send these → NULL; certificates render them
-- only when present. Agent names are an opt-in toolchain flex (PRIVACY.md).
ALTER TABLE scores ADD COLUMN streak_days INTEGER;
ALTER TABLE scores ADD COLUMN agents TEXT;
