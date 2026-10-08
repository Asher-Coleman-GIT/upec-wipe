# UPEC hardened fork

Fork of https://github.com/stephenlthorn/auto-identity-remove pinned at the commit in
`UPSTREAM_BASE`. See `docs/superpowers/specs/2026-10-07-upec-hardened-fork-design.md`
for what changed and why.

## Pulling upstream changes

    bash scripts/upstream-review.sh | less

Read the whole diff. Upstream is largely AI-written and changes quickly. Only then
merge by hand and write the reviewed commit SHA into `UPSTREAM_BASE`.
