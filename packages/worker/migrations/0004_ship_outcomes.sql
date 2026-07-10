-- Additive-nullable: ship-outcome metrics (features shipped, PRs merged).
-- Old (<=0.3.3) clients don't send these → NULL; certificates render them only
-- when present. Derived locally from git log (conventional feat: commits and
-- merge/squash-merged PRs) across all of the author's repos.
ALTER TABLE scores ADD COLUMN feats_shipped INTEGER;
ALTER TABLE scores ADD COLUMN prs_merged INTEGER;
