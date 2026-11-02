import { MODULE_ID, INCLUDED_ITEM_TYPES, KNOWN_CATEGORIES, SIDES, SIDE_ICONS } from "../constants.mjs";
import { isUsableType, isEmpty, getUses } from "../use-consumable.mjs";

/**
 * data/consumables-data.mjs
 *
 * Pure data-layer helpers for the Party Consumables Tracker. Nothing in this file touches
 * the DOM or ApplicationV2 - it only reads pf2e/sf2e actor & item data and returns plain
 * objects/arrays that the app layer renders. Keeping this separate makes the filtering/
 * sorting/grouping logic independently testable and reusable (e.g. from the blacklist
 * config app, which also needs the list of currently-tracked item names).
 */

/* -------------------------------------------- */
/*  Actor resolution                             */
/* -------------------------------------------- */

/** Use the first party actor, falling back to player-owned characters. */
function getActivePartyActor() {
  return game.actors.find((a) => a.type === "party") ?? null;
}

/** Resolve embedded party members or their UUID references. */
function getPartyMembers(partyActor) {
  if (!partyActor) return [];

  if (Array.isArray(partyActor.members)) {
    return partyActor.members.filter((a) => a?.type === "character");
  }

  const memberRefs = partyActor.system?.details?.members ?? [];
  return memberRefs
    .map((ref) => {
      try {
        return fromUuidSync(ref.uuid);
      } catch (err) {
        console.warn(`${MODULE_ID} | Could not resolve party member ${ref?.uuid}`, err);
        return null;
      }
    })
    .filter((a) => a?.type === "character");
}

/**
 * Every player-owned "character" actor in the world. Used as the fallback "party" list, and
 * as the base pool for the "specific character" / "specific player" view modes.
 */
function getAllPlayerCharacters() {
  return game.actors.filter((a) => a.type === "character" && a.hasPlayerOwner);
}

/**
 * Resolve which actors should be shown for a given view mode.
 *
 * @param {"party"|"player"|"character"} mode
 * @param {{actorId?: string|null, userId?: string|null}} options
 * @returns {Actor[]}
 */
export function getTrackedActors(mode, { actorId = null, userId = null } = {}) {
  const allCharacters = getAllPlayerCharacters();

  switch (mode) {
    case "character": {
      const actor = actorId ? game.actors.get(actorId) : null;
      return actor && allCharacters.includes(actor) ? [actor] : [];
    }

    case "player": {
      const user = userId ? game.users.get(userId) : null;
      if (!user) return [];
      // "OWNER" permission (not just observer) is what determines a player's characters.
      return allCharacters.filter((a) => a.testUserPermission(user, "OWNER"));
    }

    case "party":
    default: {
      const partyActor = getActivePartyActor();
      const members = getPartyMembers(partyActor);
      return members.length ? members : allCharacters;
    }
  }
}

/* -------------------------------------------- */
/*  Item-level pf2e/sf2e data access             */
/* -------------------------------------------- */

/**
 * Whether an item currently sits inside a container (e.g. a backpack or bag of holding)
 * rather than loose in the actor's main inventory.
 *
 * pf2e/sf2e physical items store the id of their parent container item at
 * `system.containerId`. It is `null`/empty when the item is not inside anything.
 */
function isInContainer(item) {
  return Boolean(item.system?.containerId);
}

/**
 * The consumable's sub-type (potion, scroll, wand, elixir, etc).
 *
 * Current pf2e/sf2e data models store this at `system.category`. Older, not-yet-migrated
 * worlds may still have it at `system.consumableType.value` (the pre-migration schema), so
 * we check both. Falls back to "other" if neither is present.
 */
function getItemCategory(item) {
  return item.system?.category ?? item.system?.consumableType?.value ?? "other";
}

/** The item's level, used for level sorting. Defaults to 0 (e.g. for SF2e "0-bulk" trinkets). */
function getItemLevel(item) {
  return Number(item.system?.level?.value ?? 0);
}

/** The item's trait slugs (e.g. "magical", "healing", "alchemical"). */
function getItemTraits(item) {
  return Array.isArray(item.system?.traits?.value) ? item.system.traits.value : [];
}

/** The item's rarity slug ("common", "uncommon", "rare", "unique"), for UI color-coding. */
function getItemRarity(item) {
  return item.system?.traits?.rarity ?? "common";
}

/**
 * Whether an item matches an entry on the GM's blacklist.
 *
 * Blacklist entries can be either an exact item id, an item slug, or an item name
 * (case-insensitive, whitespace-trimmed). Matching against multiple identifiers means the
 * GM can blacklist "by name" (easy to type, matches everywhere that name is used) or "by id"
 * (precise, survives the item being renamed).
 */
function isBlacklisted(item, blacklist) {
  if (!blacklist?.length) return false;
  const needles = blacklist.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  if (!needles.length) return false;

  const candidates = [item.id, item.slug, item.system?.slug, item.name]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase());

  return candidates.some((candidate) => needles.includes(candidate));
}

/**
 * Which side a tracked actor is on. Player characters are "pc"; combat NPCs are marked by
 * their token disposition (friendly = ally, hostile = enemy, otherwise neutral).
 */
export function getActorSide(actor, token = null) {
  if (actor?.type === "character" && actor.hasPlayerOwner) return "pc";
  const D = CONST.TOKEN_DISPOSITIONS;
  const disposition = token?.disposition ?? actor?.prototypeToken?.disposition;
  if (disposition === D.FRIENDLY) return "ally";
  if (disposition === D.HOSTILE) return "enemy";
  return "neutral";
}

/** Localized side label. */
export function getSideLabel(side) {
  return game.i18n.localize(`${MODULE_ID}.Side.${SIDES.includes(side) ? side : "neutral"}`);
}

/** Display fields for a side marker, also used for GM-shared ally rows. */
export function sideFields(side) {
  const key = SIDES.includes(side) ? side : "neutral";
  return {side: key, sideLabel: getSideLabel(key), sideIcon: SIDE_ICONS[key]};
}

/**
 * Convert a raw pf2e/sf2e Item document into the plain object the tracker app renders.
 */
function normalizeConsumable(item, actor, {side, displayName} = {}) {
  const canUse = Boolean(actor.isOwner) && isUsableType(item);
  const uses = getUses(item);
  const showCharges = uses && Number.isFinite(uses.value) && Number.isFinite(uses.max) && uses.max > 1;
  const known = game.user.isGM ? item.system?.identification?.identified : null;
  const containerId = item.system?.containerId;
  const container = containerId ? actor.items.get(containerId) : null;
  return {
    id: item.id,
    actorUuid: actor.uuid,
    uuid: item.uuid,
    name: known?.name || item.name,
    img: known?.img || item.img,
    unidentified: Boolean(game.user.isGM && item.isIdentified === false),
    charges: showCharges ? {value: uses.value, max: uses.max} : null,
    inContainer: Boolean(containerId),
    containerName: container?.name ?? "",
    quantity: Number(item.system?.quantity ?? 1),
    level: getItemLevel(item),
    category: getItemCategory(item),
    traits: getItemTraits(item),
    rarity: getItemRarity(item),
    actorId: actor.id,
    actorName: displayName || actor.name,
    actorImg: actor.img,
    ...sideFields(side ?? getActorSide(actor)),
    canOpen: true,
    canUse,
    canReveal: Boolean(game.user.isGM && actor.type === "npc"),
    revealed: (item.getFlag?.(MODULE_ID, "revealed") ?? item.flags?.[MODULE_ID]?.revealed) === true,
    empty: isEmpty(item),
    useDisabled: canUse && isEmpty(item),
    canRequest: !game.user.isGM && actor.type === "character" && !actor.isOwner && actor.hasPlayerOwner && Number(item.system?.quantity ?? 1) > 0
  };
}

/**
 * Gather every tracked consumable on a single actor, applying the container-exclusion and
 * blacklist filters.
 *
 * @param {Actor} actor
 * @param {{ignoreContainerItems: boolean, blacklist: string[], side?: string, displayName?: string}} options
 */
export function getActorConsumables(actor, { ignoreContainerItems, blacklist, side, displayName }) {
  return actor.items
    .filter((item) => {
      if (!INCLUDED_ITEM_TYPES.has(item.type)) return false;
      if (ignoreContainerItems && isInContainer(item)) return false;
      if (isBlacklisted(item, blacklist)) return false;
      return true;
    })
    .map((item) => normalizeConsumable(item, actor, { side, displayName }));
}

/* -------------------------------------------- */
/*  Grouping & sorting                           */
/* -------------------------------------------- */

/**
 * Group a flat list of normalized consumables by the requested key.
 *
 * Note on "trait" grouping: a single item can carry multiple traits, so it will appear
 * under every one of its trait groups (e.g. an item with both "magical" and "healing"
 * traits shows up in both groups). This is intentional for a browsing/filtering view -
 * an item without any traits is placed in a dedicated "notrait" bucket rather than dropped.
 *
 * @param {object[]} items
 * @param {"none"|"category"|"trait"|"character"} groupBy
 * @returns {Record<string, object[]>}
 */
export function groupConsumables(items, groupBy) {
  if (groupBy === "none") return { "": items };

  const groups = Object.create(null);
  for (const item of items) {
    let keys;
    switch (groupBy) {
      case "category":
        keys = [item.category];
        break;
      case "trait":
        keys = item.traits.length ? item.traits : ["notrait"];
        break;
      case "character":
        keys = [item.actorName];
        break;
      case "side":
        keys = [item.side ?? "neutral"];
        break;
      default:
        keys = [""];
    }
    for (const key of keys) {
      (groups[key] ??= []).push(item);
    }
  }
  return groups;
}

/**
 * Sort a flat list of normalized consumables.
 *
 * @param {object[]} items
 * @param {"name"|"level"|"character"} sortBy
 * @param {"asc"|"desc"} sortDir
 */
export function sortConsumables(items, sortBy, sortDir = "asc") {
  const sorted = [...items].sort((a, b) => {
    let result = 0;
    switch (sortBy) {
      case "level":
        result = a.level - b.level;
        break;
      case "character":
        result = a.actorName.localeCompare(b.actorName);
        break;
      case "name":
      default:
        result = a.name.localeCompare(b.name);
        break;
    }
    // Stable secondary sort by name so items don't jump around when the primary key ties.
    if (result === 0 && sortBy !== "name") result = a.name.localeCompare(b.name);
    return sortDir === "desc" ? -result : result;
  });
  return sorted;
}

/* -------------------------------------------- */
/*  Label helpers                                */
/* -------------------------------------------- */

function humanizeSlug(slug) {
  return String(slug)
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Localized (or humanized-fallback) label for a consumable category slug. */
export function getCategoryLabel(category) {
  const key = category || "other";
  const i18nKey = `${MODULE_ID}.Category.${key}`;
  if (KNOWN_CATEGORIES.includes(key) && game.i18n.has(i18nKey)) {
    return game.i18n.localize(i18nKey);
  }
  return humanizeSlug(key);
}

/**
 * Localized (or humanized-fallback) label for a trait slug.
 *
 * pf2e/sf2e don't expose one single merged "all traits" dictionary - trait labels are
 * spread across several `CONFIG.PF2E.*Traits` / `CONFIG.SF2E.*Traits` dictionaries
 * depending on what kind of thing the trait usually appears on (weapons, actions, spells,
 * alchemical items, etc). We scan the dictionaries most likely to contain a consumable's
 * traits and fall back to a humanized version of the slug if none of them have an entry -
 * this keeps the tracker fully functional even if the exact dictionary names differ between
 * pf2e/sf2e versions.
 */
export function getTraitLabel(slug) {
  if (slug === "notrait") return game.i18n.localize(`${MODULE_ID}.NoTraits`);

  const systemConfig = CONFIG[game.system.id.toUpperCase()];
  const candidateDictionaries = [
    "consumableTraits",
    "alchemicalTraits",
    "magicTraits",
    "spellTraits",
    "weaponTraits",
    "npcAttackTraits",
    "actionTraits",
    "itemTraits",
    "traits"
  ];

  for (const dictName of candidateDictionaries) {
    const label = systemConfig?.[dictName]?.[slug];
    if (label) return game.i18n.localize(label);
  }

  return humanizeSlug(slug);
}
