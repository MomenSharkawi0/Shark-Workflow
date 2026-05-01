# Detailed Plan — Inventory Module

## Summary

Add an inventory tracking module to the existing Laravel HR platform. Each location (warehouse, branch) holds stock; transfers between locations are recorded; stock-outs trigger an alert.

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `app/Models/Location.php` | CREATE | Eloquent model for warehouses/branches |
| `app/Models/StockItem.php` | CREATE | Stock balance per (location, sku) |
| `app/Models/Transfer.php` | CREATE | Movement records |
| `app/Filament/Resources/LocationResource.php` | CREATE | Filament admin CRUD |
| `database/migrations/2026_05_01_000001_create_locations_table.php` | CREATE | Schema |
| `database/migrations/2026_05_01_000002_create_stock_items_table.php` | CREATE | Schema |
| `database/migrations/2026_05_01_000003_create_transfers_table.php` | CREATE | Schema |
| `app/Services/StockService.php` | CREATE | Transfer logic + low-stock alerts |
| `tests/Feature/StockTransferTest.php` | CREATE | End-to-end test of transfer flow |

## Implementation Steps

1. Generate migrations for `locations`, `stock_items`, `transfers`.
2. Create Eloquent models with relationships (`Location hasMany StockItem`, `Transfer belongsTo Location`).
3. Build `StockService::transfer($from, $to, $sku, $qty)` — atomic, with row-level locking.
4. Wire low-stock threshold per stock_item; emit `StockBelowThresholdEvent`.
5. Create Filament resources for Location, StockItem, Transfer with the standard CRUD + bulk actions.
6. Add a Filament dashboard widget: "Locations below threshold" with one-click reorder buttons.
7. Write feature tests covering happy path, insufficient-stock failure, concurrent transfer.
8. Run `php artisan test --filter=Stock`.

## Risk Assessment

- MEDIUM: concurrent transfers without proper locking could double-book stock. Mitigated by row-level locks in `StockService::transfer`.
- LOW: Filament v3 is stable; no version compat surprises expected.

## Test Strategy

- Unit: `StockService` methods in isolation with in-memory SQLite.
- Feature: full HTTP request through Filament panels.
- Manual: spot-check Filament UI for low-stock indicator visibility.

## Rollback Plan

- Drop the three new tables; remove the four new files. No production data depends on these tables yet.
