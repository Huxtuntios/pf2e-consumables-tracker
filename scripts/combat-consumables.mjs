import { MODULE_ID } from "./constants.mjs";
import { getActorConsumables, sideFields } from "./data/consumables-data.mjs";

export const ALLY_QUERY = `${MODULE_ID}.combatAllies`;

/** Only combatants in the active encounter, never arbitrary tokens on a scene. */
export function getCombatNPCs(combat, disposition, { excludeHidden = false } = {}) {
  if (!combat?.active || !combat.combatants) return [];
  const seen = new Set();
  const result = [];
  for (const combatant of combat.combatants) {
    const token = combatant.token;
    const actor = combatant.actor ?? token?.actor;
    if (!token || actor?.type !== "npc" || token.disposition !== disposition ||
        (excludeHidden && (combatant.hidden || token.hidden)) || seen.has(actor.uuid)) continue;
    seen.add(actor.uuid);
    result.push({actor, token});
  }
  return result;
}

/** Whether the GM has revealed this NPC consumable to players. */
export function isRevealed(item) {
  return (item?.getFlag?.(MODULE_ID, "revealed") ?? item?.flags?.[MODULE_ID]?.revealed) === true;
}

/** Called by Foundry's targeted User.query on the active GM. Only filtered display data is
 * returned, never document handles or actions: identified allied items when the opt-in
 * setting is on, plus NPC items the GM explicitly revealed from the tracker. */
export function buildSharedCombatAllies({ combatId } = {}) {
  const combat = game.combats?.active;
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id || !combat?.active || combat.id !== combatId) return [];
  const shareAllies = game.settings.get(MODULE_ID, "shareCombatAllies");
  const ignoreContainerItems = game.settings.get(MODULE_ID, "ignoreContainerItems");
  const blacklist = game.settings.get(MODULE_ID, "blacklist");
  const D = CONST.TOKEN_DISPOSITIONS;
  const sides = [[D.FRIENDLY, "ally"], [D.NEUTRAL, "neutral"], [D.HOSTILE, "enemy"]];
  const seen = new Set();
  const result = [];
  for (const [disposition, side] of sides) {
    for (const {actor, token} of getCombatNPCs(combat, disposition, {excludeHidden:true})) {
      if (seen.has(actor.uuid)) continue;
      seen.add(actor.uuid);
      for (const row of getActorConsumables(actor, {ignoreContainerItems, blacklist})) {
        const doc = actor.items.get(row.id);
        const revealed = isRevealed(doc);
        const identified = doc?.isIdentified === true;
        if (!revealed && !(shareAllies && side === "ally" && identified)) continue;
        result.push({
          // Unidentified items keep their mystified player-facing name and image.
          name: identified ? row.name : (doc?.name ?? row.name), img: identified ? row.img : (doc?.img ?? row.img),
          quantity: row.quantity, level: row.level,
          category: row.category, traits: row.traits, rarity: row.rarity,
          charges: row.charges, empty: row.empty, inContainer: row.inContainer, containerName: row.containerName,
          actorName: token.name, ...sideFields(side), revealed, canOpen: false, canUse: false, canRequest: false, canReveal: false
        });
      }
    }
  }
  return result;
}

export function registerCombatQuery() {
  CONFIG.queries[ALLY_QUERY] = buildSharedCombatAllies;
}

/** Query the GM only for the current active combat (shared allies and revealed NPC items).
 * No privileged operations are requested. */
export async function querySharedCombatAllies() {
  const combat = game.combats?.active;
  const gm = game.users.activeGM;
  const shareAllies = game.settings.get(MODULE_ID, "shareCombatAllies");
  if (!combat?.active) return {items:[], error:false};
  if (!gm || typeof gm.query !== "function") return {items:[], error:true};
  try {
    const items = await gm.query(ALLY_QUERY, {combatId:combat.id}, {timeout:3000});
    if (game.settings.get(MODULE_ID, "shareCombatAllies") !== shareAllies || game.combats?.active?.id !== combat.id ||
        !game.combats?.active?.active || game.users.activeGM?.id !== gm.id) return {items:[], error:false};
    if (!Array.isArray(items)) throw new Error("Invalid ally response");
    return {items, error:false};
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not load shared ally consumables`, error);
    return {items:[], error:true};
  }
}
