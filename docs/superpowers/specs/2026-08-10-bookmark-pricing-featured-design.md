# Bookmark Pricing & Featured Design

## Summary

Add two manual bookmark attributes:

1. **Pricing** — `null | free | freemium | paid` (default unset / `null`)
2. **Featured** — boolean flag for personally curated “best” bookmarks (default `false`)

Both are user-set only (no auto-inference). Featured does not change list sort order.

## Data model

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `pricing` | text, nullable | `NULL` | Stored values: `free`, `freemium`, `paid` |
| `featured` | boolean | `false` | Manual highlight |

Indexes: `bookmarks_pricing_idx`, `bookmarks_featured_idx`.

Applies to all source types (`github`, `twitter`, `url`).

## API

### PATCH `/api/bookmarks/:id`

- `pricing`: `"free" | "freemium" | "paid" | null` — omit = no change; `null` clears
- `featured`: `boolean`
- Create endpoints do not accept these fields (always defaults)

### GET `/api/bookmarks`

- `pricing=free|freemium|paid|unset` — `unset` matches SQL `NULL`
- `featured=true|false` — only when present
- Default: neither filter applied

### Serialize / export

- List and detail always return `pricing` (`null` or enum) and `featured`
- Public browsing may expose both (non-sensitive)
- JSON export and markdown export include the fields when set

## UI

- **Detail form**: pricing Select (unset / free / freemium / paid); featured Switch; all sources
- **Filter panel**: pricing Select including “unset”; “featured only” Switch (default off)
- **Badges**: show pricing badge only when set; featured badge only when true — on row, card, and read-only detail meta

## Out of scope

- Auto-detect pricing from URL/README
- Featured pin-to-top / sort changes
- Feed / Insights stats for these fields
- List-row quick toggles
