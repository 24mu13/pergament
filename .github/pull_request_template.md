## Summary

<!-- One or two sentences: what does this PR add or change, and why? -->

- **Feature / area 1.** What it does and how it behaves for the user.
- **Feature / area 2.** …
- **Dependencies / build.** New or changed dependencies, dev shell, env vars, platform workarounds.
- **Docs.** README, `docs/FORMAT.md`, or other docs touched.

Closes #
Closes #

## Notes for review

<!-- Known limitations, estimates, open questions, things a reviewer should look at first. -->

- Limitation or placeholder behaviour:
- Values that are estimates or need tuning:
- Platform-specific behaviour (e.g. Wayland, NVIDIA):

## Test plan

Automated:

- [ ] `cargo test --workspace`, `cargo clippy --workspace --all-targets`
- [ ] `bun run lint`, `bun run test`, `bun run build`
- [ ] Each commit builds on its own (`cargo check --workspace`)
- [ ] Parsers / importers run against real data (list which)

Manual, in the app:

- [ ] Main happy path:
- [ ] Edge case / failure path:
- [ ] Platform- or hardware-specific check:
