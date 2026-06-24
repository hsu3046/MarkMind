# Frontend Slides Vendor Notice

The files in this directory are vendored from `zarazhangrui/frontend-slides`.

- Source repository: https://github.com/zarazhangrui/frontend-slides
- License: MIT, preserved in `LICENSE`
- Vendored on: 2026-06-23
- Usage in MarkMind: source skill, design-system, and template reference for HTML slide generation

For HTML generation, MarkMind follows the `frontend-slides` contract as closely
as practical inside the desktop app: the LLM is asked to return one complete
self-contained HTML deck with inline CSS and JavaScript using the selected
template's `design.md` and `template.html` as the implementation authority.
MarkMind keeps only its app-specific responsibilities: provider/model invocation,
stock/generated image asset resolution, placeholder replacement, local asset
bundle saving, and basic validation that the returned file is complete.
