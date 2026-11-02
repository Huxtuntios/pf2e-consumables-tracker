import { MODULE_ID } from "./constants.mjs";

/**
 * Consumable use shared by the tracker window and "take and use" delivery messages.
 *
 * PF2e Toolbelt (Actionable) does not expose its physical-item use helper publicly, so the
 * routing below mirrors `usePhysicalItem` / `consumeItem` from Toolbelt 3.59.2
 * (foundry-helpers 8697ee8): spell scrolls/wands always use the system cast flow; a
 * linked Toolbelt item macro receives `{actor, item, use, cancel}` and decides consumption;
 * with Toolbelt's "Use Consumable" enabled, Toolbelt's chat-card style is used. Without
 * Toolbelt the system's own `item.consume()` is called.
 */

const L = key => game.i18n.localize(`${MODULE_ID}.${key}`);
const F = (key, data) => game.i18n.format(`${MODULE_ID}.${key}`, data);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);

export function getUses(item) {
  const uses = item?.uses ?? item?.system?.uses;
  if (!uses || uses.value == null) return null;
  return {value: Number(uses.value), max: Number(uses.max ?? uses.value)};
}

export function getQuantity(item) {
  return Number(item?.quantity ?? item?.system?.quantity ?? 0);
}

/** Only real consumable documents expose the system use flow. Ammunition is excluded. */
export function isUsableType(item) {
  return item?.type === "consumable" && typeof item.consume === "function";
}

export function isEmpty(item) {
  const uses = getUses(item);
  return getQuantity(item) < 1 || (uses !== null && uses.value <= 0);
}

export function isCastConsumable(item) {
  const category = item?.category ?? item?.system?.category;
  return ["wand", "scroll"].includes(category) && Boolean(item?.system?.spell);
}

function toolbelt() {
  return game.modules?.get("pf2e-toolbelt")?.active ? game.toolbelt ?? null : null;
}

function toolbeltSetting(key) {
  try { return Boolean(toolbelt()?.getToolSetting?.("actionable", key)); }
  catch (error) { console.warn(`${MODULE_ID} | Could not read Toolbelt setting ${key}`, error); return false; }
}

async function toolbeltMacro(item) {
  if (isCastConsumable(item) || !toolbeltSetting("item")) return null;
  const getItemMacro = toolbelt()?.api?.actionable?.getItemMacro;
  if (typeof getItemMacro !== "function") return null;
  try { return (await getItemMacro(item)) ?? null; }
  catch (error) { console.warn(`${MODULE_ID} | Could not read Toolbelt item macro`, error); return null; }
}

/** How a use would be handled; shown as a tooltip on the tracker button. */
export async function getUseRoute(item) {
  if (!isUsableType(item)) return "none";
  if (isCastConsumable(item)) return "system";
  if (await toolbeltMacro(item)) return "macro";
  return toolbeltSetting("use") ? "toolbelt" : "system";
}

/** Port of Toolbelt's `consumeItem`: chat card without consume controls, then spend one use. */
export async function toolbeltConsume(event, item) {
  const actor = item.actor ?? item.parent;
  const speaker = ChatMessage.getSpeaker({actor});
  const flags = {[game.system.id]: {origin: {sourceId: item.sourceId, uuid: item.uuid, type: item.type}}};
  const wrapper = document.createElement("div");
  wrapper.innerHTML = (await item.toMessage?.(event, {create: false}))?.content ?? "";
  wrapper.querySelector?.("footer")?.remove();
  wrapper.querySelector?.("button[data-action='consume']")?.remove();
  const content = wrapper.outerHTML ?? "";
  const uses = getUses(item) ?? {value: 1, max: 1};
  const damage = item.system?.damage;
  const DamageRoll = damage ? CONFIG.Dice?.rolls?.find(Roll => Roll.name === "DamageRoll") : null;
  if (damage && DamageRoll) {
    const {formula, type, kind} = damage;
    await new DamageRoll(`(${formula})[${type},${kind}]`).toMessage({speaker, flavor: content, flags});
  } else {
    const key = uses.max > 1 && uses.value > 1 ? "UseMulti" : "UseSingle";
    const label = game.i18n.format(`PF2E.ConsumableMessage.${key}`, {name: item.name, current: uses.value - 1});
    await ChatMessage.create({speaker, content: `<h4 style="margin-bottom: .3em; font-size: 1.3em;">${label}</h4>${content}`, flags});
  }
  if (item.system?.uses?.autoDestroy && uses.value <= 1) {
    const quantity = Math.max(getQuantity(item) - 1, 0);
    if (quantity <= 0) await item.delete();
    else await item.update({"system.quantity": quantity, "system.uses.value": uses.max});
  } else {
    await item.update({"system.uses.value": Math.max(uses.value - 1, 0)});
  }
}

/**
 * Use one consumable as its owner. Returns true when a use flow was started.
 * @param {Item} item
 * @param {{event?: Event, confirm?: boolean}} options
 */
export async function useConsumable(item, {event, confirm = true} = {}) {
  const actor = item?.actor ?? item?.parent;
  if (!actor?.isOwner || !isUsableType(item)) { ui.notifications.warn(L("UseUnavailable")); return false; }
  if (isEmpty(item)) { ui.notifications.warn(L("UseEmpty")); return false; }
  if (confirm && game.settings.get(MODULE_ID, "confirmUse")) {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: {title: L("Use")},
      content: `<p>${esc(F("UsePrompt", {item: item.name, target: actor.name}))}</p>`,
      rejectClose: false, modal: true
    });
    if (!ok) return false;
  }
  // The item could have been used, moved or deleted while the dialog was open.
  const current = actor.items?.get ? actor.items.get(item.id) : (item.uuid ? await fromUuid(item.uuid) : item);
  const owner = current?.actor ?? current?.parent;
  if (!owner?.isOwner || !isUsableType(current)) { ui.notifications.warn(L("UseUnavailable")); return false; }
  if (isEmpty(current)) { ui.notifications.warn(L("UseEmpty")); return false; }

  if (isCastConsumable(current)) { await current.consume(); return true; }
  const macro = await toolbeltMacro(current);
  const use = (macro || toolbeltSetting("use")) ? () => toolbeltConsume(event, current) : () => current.consume();
  if (macro) {
    await macro.execute({
      actor: owner, item: current, use,
      cancel: () => {
        const message = game.toolbelt?.localize?.("actionable.item.cancel", current) ?? L("UseCancelled");
        return ui.notifications.warn(message, {localize: false});
      }
    });
    return true;
  }
  await use();
  return true;
}
