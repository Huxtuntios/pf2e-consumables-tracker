# Current audit — 1.1.6

- GM rows use the system’s identified name/image and mark unidentified status; player rows retain the system-prepared name and image. Item-sheet actions first resolve the actual actor’s embedded item, including synthetic combatant actors. Requires live Foundry testing.
- Multi-use charges and container names are displayed. New worlds show container contents by default; existing saved world settings are not overwritten. GM-shared allies remain opt-in and identified-only; the display fields include charges and container name.
- Client filters, combat toggles, compact view and collapsed groups are saved. Search resets after closing. Quick filters apply to already visible data and do not grant permissions.
- Request owners can approve or decline using separate whisper messages. Status is derived from request state plus the first valid owner decision; the active GM remains responsible for transferring. No promise of atomicity under competing decisions or failure. Deleted chat messages can make status unavailable.
- `use-consumable.mjs` mirrors Toolbelt 3.59.2 / foundry-helpers 8697ee8. This internal logic can diverge in later Toolbelt releases. Mocks are not proof of live interoperability.
- Transfer is not atomic: on error or interruption inspect both inventories manually before retrying. No distance or action checks. Existing old module-ID settings are not migrated automatically.
- Actual multi-client, synthetic token item sheets, PF2e/SF2e and Toolbelt behavior for this release must be verified in a real world. Manifest compatibility is unchanged per the author's prior testing.
