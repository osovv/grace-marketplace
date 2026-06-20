# GRACE 4 Migration Checklist

- [ ] Generated `.grace/context` artifacts reviewed.
- [ ] Generated `.grace/graph/index.xml` and graph documents reviewed.
- [ ] Generated `.grace/verification/index.xml` and verification documents reviewed.
- [ ] Ambiguities and unsupported legacy structures are listed.
- [ ] No retroactive `C-*` bundles were created.
- [ ] `grace lint --path <project-root>` passed or findings are understood.
- [ ] `grace status --path <project-root>` reports GRACE 4 state.
- [ ] Legacy cleanup proposal is explicit.
- [ ] User explicitly confirmed cleanup before deleting or moving legacy docs.
