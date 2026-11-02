/**
 * Shared constants for the Party Consumables Tracker module.
 *
 * This lives in its own file (rather than in the main entry point) specifically so that
 * `apps/*.mjs` and `data/*.mjs` can import MODULE_ID without creating a circular import
 * back through `pf2e-consumables-tracker.mjs` (which itself imports those app classes).
 */

/** The module id, matching the folder name and module.json "id" field. */
export const MODULE_ID = "pf2e-consumables-tracker";

/**
 * Item types considered "consumables" for tracking purposes.
 *
 * Track consumables and the newer ammunition item type, plus legacy scroll/wand types.
 */
export const INCLUDED_ITEM_TYPES = new Set(["consumable", "ammo", "wand", "scroll"]);

/**
 * Known consumable categories we provide built-in localized labels for. Any category not
 * in this list still displays fine - `getCategoryLabel()` falls back to a humanized version
 * of the raw category slug when no localization key exists for it.
 */
export const KNOWN_CATEGORIES = [
  "potion",
  "elixir",
  "oil",
  "scroll",
  "wand",
  "talisman",
  "snare",
  "ammo",
  "poison",
  "food",
  "tool",
  "mutagen",
  "drug",
  "ampoule",
  "serum",
  "gadget",
  "other"
];

/** Options for the "Group by" dropdown. */
export const GROUP_BY_OPTIONS = ["none", "category", "trait", "character", "side"];

/** Options for the "Sort by" dropdown. */
export const SORT_BY_OPTIONS = ["name", "level", "character"];

/** Options for the "View" dropdown. */
export const VIEW_MODE_OPTIONS = ["party", "player", "character"];

/** Row markers: player characters, allied NPCs and enemy NPCs, in display order. */
export const SIDES = ["pc", "ally", "neutral", "enemy"];

/** Font Awesome icons for each side marker. */
export const SIDE_ICONS = {
  pc: "fa-solid fa-user-shield",
  ally: "fa-solid fa-handshake",
  neutral: "fa-solid fa-circle-question",
  enemy: "fa-solid fa-skull"
};
