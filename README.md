# PF2e Consumables Tracker

[Русская версия](README.ru.md)

Foundry VTT module for Pathfinder 2e and Starfinder 2e. Browse party consumables, search, group and sort them; request a single consumable from another player. English and Russian interfaces are included.

### https://github.com/Huxtuntios/pf2e-consumables-tracker/releases/latest/download/module.json

## Install and open

Copy this folder as `Data/modules/pf2e-consumables-tracker/` and enable it in the world. Open using the flask tool under **Token Controls**, configure the **Open Consumables Tracker** keybinding, or run a script macro:

```js
game.modules.get("pf2e-consumables-tracker").api.open();
```

There is deliberately no button in the right-hand Actors sidebar. See [GUIDE.md](GUIDE.md) for permissions, requests and troubleshooting.

## Features and limitations

- **Use** button (1.1.5) on every consumable you own, right in the tracker. It follows PF2e Toolbelt exactly like its sheet ▶ button: spell scrolls/wands use the system cast flow, a linked Toolbelt item macro decides consumption, and **Use Consumable** uses Toolbelt's chat card; without Toolbelt the system `consume()` runs. Optional confirmation (personal setting, on by default). Empty items are disabled.
- **Side markers** (1.1.5): every row is marked as Player character, Ally or Enemy (colored badge and stripe) by token disposition, and you can group by **Side**. GM toggles add allied and/or hostile NPCs of the active combat.
- Party, player or character views; category, trait or character groups; search and sorting. Player visibility is bounded by Foundry document permissions.
- GM-only toggle adds hostile NPC participants of the active combat, including unlinked tokens; it does not add unrelated NPCs elsewhere on the scene. It is off on opening and does not expose enemies to players. Multiple linked tokens of the same actor appear once.
- Optional GM world setting shares identified consumable display data of visible friendly NPC combatants with players, even without NPC-sheet permissions. It is off by default, excludes hidden tokens/combatants and unidentified items, and respects the blacklist and container setting. Shared NPC rows are read-only; no NPC transfer or item-sheet access is granted.
- Requests: the player chooses an owned recipient and requests **one** item. An online player owner approves in whispered chat; the active GM confirms and executes the system transfer. For “take and use”, the recipient separately clicks Use in the delivery message, on their client. No automatic roll or consumption is performed by the GM.
- The system's transfer and `consume` methods are used when available. The delivery Use button runs the same Toolbelt-aware routine as the tracker's Use button. Not every item exposes `consume`; ammunition and other special items may require their sheet or another system action. Rules for casting, charges and effects belong to the game system; usage can be rejected or require further interaction there.
- No distance, line-of-sight, action cost or turn checks; decide those at the table. Transfer is not atomic. If it fails or is interrupted, check both inventories manually before retrying.
- GM blacklist and optional container filtering are display filters, not security controls.

## Compatibility

Targets Foundry VTT 13+ with PF2e or SF2e. The transfer and use APIs and both systems need testing in your actual versions: no live Foundry environment was available for this build. The manifest lists Foundry 14 as verified based on the author's own testing.

## Publishing a release

The source archive is intended for GitHub Desktop. Copy its contents into a repository (preserve `.git`), commit and push. The workflow `.github/workflows/release.yml` runs tests and builds `module.json` and `module.zip` when a matching version tag (e.g. `v1.1.4`) is pushed. URLs are generated from the actual repository; nothing is published by installing the source. Enable GitHub Actions and allow workflow write permissions as needed. A release manifest exists only after a successful published release.

## Migration

This is a **new module ID**, not an in-place update. Disable the old `party-consumables-tracker` before enabling this one; do not run both. Back up the world. Existing settings (including blacklist) and client preferences do not automatically migrate; copy/re-enter them manually. Existing macros and keybindings must be changed to the new ID.

## License

MIT. The original copyright notice is retained in [LICENSE.txt](LICENSE.txt).

## PF2e Toolbelt

Optional; not a required dependency. Inspected against Toolbelt 3.59.2 and its pinned foundry-helpers commit `8697ee8`. Toolbelt's physical-item use helper is not in its public API, so the tracker mirrors its routing: cast scrolls/wands → system `consume()`; **Item Macro** with a linked macro (via the public `getItemMacro`) → `macro.execute({actor, item, use, cancel})`; **Use Consumable** → Toolbelt-style chat card and use/quantity decrement; otherwise the system `consume()`. The button tooltip shows which route applies. Settings are read on the user's client at click time. This is source analysis plus mocked tests, not a live Foundry interoperability test.

## Combat ally sharing

With **Show players allied NPC consumables in combat** on, the active GM supplies token names and identified item names, images, quantity, level, rarity, category and traits to all players, including those without access to the NPC actor. This is a deliberate disclosure, not an actor permission change. Only friendly-disposition NPC token combatants of the active encounter are eligible, including before its first round; neutral or out-of-combat tokens, hidden tokens/combatants and unidentified items are excluded. Defeated combatants remain included until removed from combat. Data is read-only, non-persistent, and refreshed when relevant hooks arrive or approximately every 10 seconds while the window is open. A connected active GM and Foundry’s `QUERY_USER` permission are required; otherwise the tracker shows a warning. Turning the setting off stops further sharing but cannot revoke information already seen.
