# DeepSeek Harness skills

The archive ships these under `.dsh/skills/`. DeepSeek Harness discovers that folder from the Git root. If auto-discovery is unavailable in a custom profile, ask the harness to read the relevant `SKILL.md` directly. [DeepSeek discovery documentation](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.md).

| Skill | Use it for | Source and revision |
|---|---|---|
| `ponytail`, `ponytail-audit` | Simple implementation, local-first scan worker, and a pass for needless complexity | [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail/tree/96608e078b2d5ea607c5c3b8b5a54d1c1fba6846/skills) · MIT |
| `design-taste-frontend` | Marketplace hierarchy, typography, source-matched photos and copy | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill/tree/f6b76575f949707b4e3c37cd86cb44b0b98643e8/skills/taste-skill) · MIT · local reading profile, original SKILL.md and five text references included |
| `impeccable` | Critique, layout, polish, responsive adaptation and accessibility hardening | [pbakaus/impeccable](https://github.com/pbakaus/impeccable/tree/b49177d32788f2dc585c42831d845dacf1ebed2c/.dsh/skills/impeccable) · Apache-2.0 · upstream DeepSeek profile |
| `systematic-debugging`, `verification-before-completion` | Reproduce before changing code and require fresh evidence before closing work | [obra/superpowers](https://github.com/obra/superpowers/tree/22f0b463e7a5e579904dd6211a520321035526f7/skills) · MIT |
| `webapp-testing` | Browser evidence, logs and screenshots where the existing JS harness needs help | [anthropics/skills](https://github.com/anthropics/skills/tree/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/webapp-testing) · Apache-2.0 |

GitHub repo pages checked 20 November 2026 showed approximately 195k stars for Ponytail, 119k for Taste, 114k for Impeccable, 322k for Superpowers and 198k for Anthropic Skills. Counts are for repositories and change over time. Selection was based on fit for this repo as well as adoption signals.

## Suggested skill use by task

- **Catalogue design** — Taste reading profile for the initial pass, then Impeccable critique on actual screenshots. Keep the LihatDulu brief as the source of truth. Useful review dimensions are layout, typography, responsive adaptation and accessibility.
- **Bug fixing** — Systematic Debugging, then Ponytail for narrowing the fix and Verification Before Completion for the result.
- **Scan integration** — Ponytail, Systematic Debugging and Verification Before Completion. Confirm real device footage and CLI behavior at each boundary.
- **Browser QA** — Use the repo's JS/Playwright harness first. Webapp Testing offers an optional Python Playwright workflow; its runner is not an app dependency.
- **Optional standards reference** — [Vercel Web Interface Guidelines](https://github.com/vercel-labs/agent-skills/tree/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/web-design-guidelines) is linked for accessibility and interface checks. Its parent repo showed about 35k stars. React-specific guidance is unnecessary for this Vite/JS app.

The ZIP installs repo-scoped files by extraction. No global profile or package manifest is modified. Upstream advice may mention optional integrations and shell helpers. Read commands before running them, and use built-in tools where they already work. The full Taste kit is available in the pinned upstream tree with its associated photo credits and assets. No Taste assets or automatic hooks are activated by the local profile.
