# Filter Bars for DMA & Utilities Dashboard Pages

Date: 2026-08-16
Status: Approved (design)

## Goal

Extend the existing free-text search on `/dashboard/dmas` and `/dashboard/utilities`
with dedicated filter controls so users can quickly narrow results by status, location,
manager, and empty-data states — making the system more user friendly.

## Current State

- Both pages already have a single search `<Input>` that matches several fields client-side
  (`name`, `managerName`, `status`, `description`, counts).
- Results are already scoped by role before filtering (admin sees all, utility manager sees own).
- Both pages have a results-count display already.
- No dedicated filter controls exist.

## Approach

**Approach A — Inline filter bar** (chosen). A single row (wrapping on mobile) containing the
existing search box plus compact controls: a status segmented toggle, location dropdown,
manager dropdown, empty-data checkboxes, and a Reset link.

### Layout

```
[🔍 Search...............] [Status: All | Active | Inactive] [Region ▾] [Manager ▾]  (Reset)
[Filter count: 4 results]   ← existing count line stays
```

### Controls per page

| Control | Utilities page | DMAs page |
|---|---|---|
| Status | `All / Active / Inactive` segmented toggle | Same |
| Region | `regionName` dropdown (options built from data) | `utilityName` dropdown (DMAs belong to a utility) |
| Manager | `managerName` dropdown | `managerName` dropdown |
| Empty-data | "0 DMAs" + "0 reports" checkboxes | "0 teams" + "0 reports" + "0 engineers" checkboxes |
| Reset | link shown when any non-default filter is set | same |

### Behavior

- All filters AND together with each other and with the search box.
- Filters apply on top of the already role-scoped list (no change to scoping).
- Active status / region / manager controls show a small filter-count indicator so the user
  notices a filter is applied.
- Empty-data checkbox checked ⇒ show only entities where that count is 0; unchecked ⇒ no
  constraint on that metric.
- Reset clears all filters AND the search input.
- Filter state is local component state (no URL params, no server round-trip) —
  all filtering is client-side over already-fetched data.

## Components / Data Flow

- Add filter state to each view component:
  - `statusFilter: "all" | "active" | "inactive"`
  - `regionFilter: string` (empty = all) — utilities `regionName`, dmas `utilityName`
  - `managerFilter: string` (empty = all)
  - `emptyFilters: Set<string>` — utility metric keys: `dmas`, `reports`;
    dma metric keys: `teams`, `reports`, `engineers`
- The existing `filteredDMAs` / `filteredUtilities` predicates extend to combine the new
  filter state; search matching stays as-is.
- A small shared inline segmented-toggle (All/Active/Inactive) can be reused across both pages,
  or implemented inline per page following existing patterns. Prefer reuse via a tiny local
  component if clean; avoid over-abstracting for two usages.

## Styling

- Match Signature A card language: cyan/slate-only accents; calm borders (`border-slate-200/80`),
  rounded `xl` controls, subtle focus states (`focus:border-cyan-400 focus:ring-cyan-400/20`).
- Segmented status toggle: pills — default `text-slate-500`, selected = cyan tint.
- Dropdowns: native `<select>` or existing `DropdownMenu`? Prefer simple styled `<select>` for
  calm compactness unless the codebase already uses a select pattern elsewhere (check first).

## Error Handling

- No new server calls; no error handling needed beyond existing data fetch paths.
- Dropdown options derive from current data; safe when data is empty (render placeholder option).

## Testing

- Manual verification on both pages as admin and utility manager:
  1. Filter by status and confirm only matching cards remain.
  2. Filter by region/utility and manager.
  3. Toggle empty-data checkboxes against known entities.
  4. Search + filter combination returns intersection.
  5. Reset clears everything.
- Run `npx tsc --noEmit` and `npm run build` to verify no type/build regressions.