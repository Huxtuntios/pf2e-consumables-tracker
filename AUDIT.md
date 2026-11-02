# Combatant views — 1.1.3

- GM enemy toggle now selects hostile NPC token combatants of the active encounter, not all NPC tokens on a scene. Linked actors are deduplicated; unlinked token actors remain distinct.
- The GM world setting for friendly NPC consumables defaults off. A targeted Foundry User.query asks the active GM only for the active combat. The response is read-only display data for identified, filtered consumables of visible friendly NPC combatants; no item or actor UUIDs are sent, and hidden tokens or combatants are excluded. Opting in deliberately reveals token names and item details even without NPC sheet access.
- No query is used to transfer or consume items. Shared rows cannot open item sheets or request NPC items. Queries require an active GM and Foundry QUERY_USER permission. Change hooks and a ten-second refresh invalidate the player cache; information already received cannot be revoked. Combatants count before the first round and while defeated until removed.
- Automated tests use mock Foundry/PF2e/SF2e data; actual multiple-client query behavior, visibility, timing, permissions and real systems require a live-world test.

# Toolbelt compatibility audit — 1.1.1

- Inspected PF2e Toolbelt 3.59.2, commit `8109338b90cbe270d30a439952330d1e448950a3`, and its pinned `foundry-helpers` commit `8697ee87188e65786f9b071f56f895b9c9523b60`.
- `Actionable → Use Consumable` creates a sheet control invoking the helper `usePhysicalItem`; `Actionable → Item Macro` can route usage through a linked script macro. The helper is not part of the public Toolbelt API. Old 1.1.0 directly called `item.consume()` and bypassed that behavior.
- New delivery action opens the recipient's character sheet rather than consuming when Toolbelt use or a linked item macro applies. User must press Toolbelt's sheet button; opening the sheet does not consume. Macro detection uses the Toolbelt public API. Unknown Toolbelt API/settings fail safely to sheet. Scrolls/wands with embedded spells follow the inspected helper's macro exclusion. Toolbelt requires identified items for its inventory button.
- Better Merchant wraps actor transfer, but delegates unchanged when neither actor is a merchant; this module only requests character-to-character transfers. Better Trade affects sheet drag/drop, not this direct GM transfer call. This is source analysis, not proof of runtime interoperability.
- Added mocked tests for per-user Use Consumable, Item Macro, missing API, spell items, SF2e, disabled Toolbelt, no extra consumption and empty charges. Real multi-client Foundry tests with actual versions, alternate sheets, macros and other Toolbelt settings remain necessary.

# Audit and changes — 1.1.0

- Renamed module ID, paths, localized keys, API and CSS namespace. Old settings are not automatically migrated.
- Removed Actors-sidebar injection and its unused CSS. Retained Token Controls, keybinding and macro access; the documented V13/V14 control-button callback is used.
- Added GM-only hostile current-scene NPC token view. Linked actor duplicates are deduplicated by UUID; synthetic token actors remain distinct.
- Added owner approval, active-GM execution and requester-side system consumption, using whisper messages rather than a privileged module socket. A fixed one-item amount avoids accidental stack transfers.
- Added `ammo` to tracked types for newer system models, permission checks for player actor browsing, safe grouping for special keys, and a namespaced Handlebars helper. Search input selection is read only for text inputs.
- Replaced unsupported release/compatibility claims with explicit limitations. Retained MIT notice. No repository URL is fabricated in source; tag workflow derives it from GitHub at release time.
- Tests mock Foundry documents and cover transfer, approval, stale/replayed requests, errors, hostile token visibility, filters, localization and manifest. They do not prove real server behavior or compatibility across actual Foundry/PF2e/SF2e releases.
- Transfer is non-atomic; processing or failed requests are locked for manual reconciliation. There is no automated recovery, no distance/action checks, no automatic settings migration and no direct access to items denied by Foundry permissions.
