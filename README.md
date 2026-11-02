# PF2e Consumables Tracker

[Русская версия](README.ru.md)

Foundry VTT module for Pathfinder 2e and Starfinder 2e. Browse party consumables, search, group and sort them; request a single consumable from another player. English and Russian interfaces are included.

## Install and open

Copy this folder as `Data/modules/pf2e-consumables-tracker/` and enable it in the world. Open using the flask tool under **Token Controls**, configure the **Open Consumables Tracker** keybinding, or run a script macro:

```js
game.modules.get("pf2e-consumables-tracker").api.open();
```

There is deliberately no button in the right-hand Actors sidebar. See [GUIDE.md](GUIDE.md) for permissions, requests and troubleshooting.

## Features and limitations

- Party, player or character views; category, trait or character groups; search and sorting. Player visibility is bounded by Foundry document permissions.
- GM-only toggle adds hostile NPC participants of the active combat, including unlinked tokens; it does not add unrelated NPCs elsewhere on the scene. It is off on opening and does not expose enemies to players. Multiple linked tokens of the same actor appear once.
- Optional GM world setting shares identified consumable display data of visible friendly NPC combatants with players, even without NPC-sheet permissions. It is off by default, excludes hidden tokens/combatants and unidentified items, and respects the blacklist and container setting. Shared NPC rows are read-only; no NPC transfer or item-sheet access is granted.
- Requests: the player chooses an owned recipient and requests **one** item. An online player owner approves in whispered chat; the active GM confirms and executes the system transfer. For “take and use”, the recipient separately clicks Use in the delivery message, on their client. No automatic roll or consumption is performed by the GM.
- The system's transfer and `consume` methods are used when available. With PF2e Toolbelt’s **Use Consumable** enabled, or **Item Macro** enabled with a linked macro, the recipient is directed to Toolbelt’s own use button on the character inventory sheet instead of bypassing its settings. Not every item exposes `consume`; ammunition and other special items may require their sheet or another system action. Rules for casting, charges and effects belong to the game system; usage can be rejected or require further interaction there.
- No distance, line-of-sight, action cost or turn checks; decide those at the table. Transfer is not atomic. If it fails or is interrupted, check both inventories manually before retrying.
- GM blacklist and optional container filtering are display filters, not security controls.

## Compatibility

Targets Foundry VTT 13+ with PF2e or SF2e. The transfer and use APIs and both systems need testing in your actual versions: no live Foundry environment was available for this build. No version is marked verified without such a test.

## Publishing a release

The source archive is intended for GitHub Desktop. Copy its contents into a repository (preserve `.git`), commit and push. The workflow `.github/workflows/release.yml` runs tests and builds `module.json` and `module.zip` when a matching version tag (e.g. `v1.1.3`) is pushed. URLs are generated from the actual repository; nothing is published by installing the source. Enable GitHub Actions and allow workflow write permissions as needed. A release manifest exists only after a successful published release.

## Migration

This is a **new module ID**, not an in-place update. Disable the old `party-consumables-tracker` before enabling this one; do not run both. Back up the world. Existing settings (including blacklist) and client preferences do not automatically migrate; copy/re-enter them manually. Existing macros and keybindings must be changed to the new ID.

## License

MIT. The original copyright notice is retained in [LICENSE.txt](LICENSE.txt).

## PF2e Toolbelt

Optional; not a required dependency. Inspected against Toolbelt 3.59.2 and its pinned foundry-helpers source. Its physical-item use helper is not exposed in the Toolbelt public API; when relevant settings are enabled, the delivery message opens the recipient’s sheet instead of silently skipping Toolbelt or duplicating its implementation. Select **Inventory**, find the item and press Toolbelt’s ▶ use control. No automatic use happens on opening the sheet. Toolbelt only adds this button for identified consumables; check identification and settings if it is missing. Cast scrolls/wands follow Toolbelt’s own macro-exclusion behavior. This path is not a live Foundry interoperability test.

## Combat ally sharing

With **Show players allied NPC consumables in combat** on, the active GM supplies token names and identified item names, images, quantity, level, rarity, category and traits to all players, including those without access to the NPC actor. This is a deliberate disclosure, not an actor permission change. Only friendly-disposition NPC token combatants of the active encounter are eligible, including before its first round; neutral or out-of-combat tokens, hidden tokens/combatants and unidentified items are excluded. Defeated combatants remain included until removed from combat. Data is read-only, non-persistent, and refreshed when relevant hooks arrive or approximately every 10 seconds while the window is open. A connected active GM and Foundry’s `QUERY_USER` permission are required; otherwise the tracker shows a warning. Turning the setting off stops further sharing but cannot revoke information already seen.
