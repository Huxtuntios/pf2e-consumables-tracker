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

/** Called by Foundry's targeted User.query on the active GM. Sharing is intentionally
 * opt-in: only identified, filtered item display data, never document handles or actions. */
export function buildSharedCombatAllies({ combatId } = {}) {
  const combat = game.combats?.active;
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id ||
      !game.settings.get(MODULE_ID, "shareCombatAllies") || !combat?.active || combat.id !== combatId) return [];
  const ignoreContainerItems = game.settings.get(MODULE_ID, "ignoreContainerItems");
  const blacklist = game.settings.get(MODULE_ID, "blacklist");
  const result = [];
  for (const {actor, token} of getCombatNPCs(combat, CONST.TOKEN_DISPOSITIONS.FRIENDLY, {excludeHidden:true})) {
    const identified = new Set(actor.items.filter(item => item.isIdentified === true).map(item => item.id));
    for (const item of getActorConsumables(actor, {ignoreContainerItems, blacklist})) {
      if (!identified.has(item.id)) continue;
      result.push({
        name: item.name, img: item.img, quantity: item.quantity, level: item.level,
        category: item.category, traits: item.traits, rarity: item.rarity,
        charges: item.charges, empty: item.empty, inContainer: item.inContainer, containerName: item.containerName,
        actorName: token.name, ...sideFields("ally"), canOpen: false, canUse: false, canRequest: false
      });
    }
  }
  return result;
}

export function registerCombatQuery() {
  CONFIG.queries[ALLY_QUERY] = buildSharedCombatAllies;
}

/** Query the GM only for the current active combat. No privileged operations are requested. */
export async function querySharedCombatAllies() {
  const combat = game.combats?.active;
  const gm = game.users.activeGM;
  if (!game.settings.get(MODULE_ID, "shareCombatAllies") || !combat?.active) return {items:[], error:false};
  if (!gm || typeof gm.query !== "function") return {items:[], error:true};
  try {
    const items = await gm.query(ALLY_QUERY, {combatId:combat.id}, {timeout:3000});
    if (!game.settings.get(MODULE_ID, "shareCombatAllies") || game.combats?.active?.id !== combat.id ||
        !game.combats?.active?.active || game.users.activeGM?.id !== gm.id) return {items:[], error:false};
    if (!Array.isArray(items)) throw new Error("Invalid ally response");
    return {items, error:false};
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not load shared ally consumables`, error);
    return {items:[], error:true};
  }
}
