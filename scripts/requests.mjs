import { MODULE_ID, INCLUDED_ITEM_TYPES } from "./constants.mjs";

const L = key => game.i18n.localize(`${MODULE_ID}.${key}`);
const F = (key, data) => game.i18n.format(`${MODULE_ID}.${key}`, data);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const authorId = message => message?.author?.id ?? message?.user?.id ?? message?.user;
const flags = message => message?.getFlag(MODULE_ID, "request");
const activeGM = () => game.users.activeGM;
const running = new Set();
const notify = key => ui.notifications.warn(L(key));

function resolveRequest(message) {
  const data = flags(message);
  const requester = game.users.get(authorId(message));
  const source = game.actors.get(data?.sourceId);
  const target = game.actors.get(data?.targetId);
  const item = source?.items.get(data?.itemId);
  if (data?.kind !== "request" || !requester || requester.isGM || !source || !target || source.id === target.id ||
      source.type !== "character" || target.type !== "character" || !source.hasPlayerOwner ||
      !target.testUserPermission(requester, "OWNER") || source.testUserPermission(requester, "OWNER") ||
      !source.testUserPermission(requester, "OBSERVER") || !item || !INCLUDED_ITEM_TYPES.has(item.type) ||
      !Number.isInteger(data.quantity) || data.quantity !== 1 || !["take", "use"].includes(data.mode)) return null;
  return {data, requester, source, target, item};
}

export async function createRequest(uuid, recipientId) {
  if (game.user.isGM) return;
  const item = await fromUuid(uuid);
  const source = item?.parent;
  const target = game.actors.get(recipientId);
  const gm = activeGM();
  const owners = game.users.filter(u => !u.isGM && u.active && source?.testUserPermission(u, "OWNER"));
  if (!gm) return notify("NoGM");
  if (!owners.length) return notify("NoOwner");
  if (!source || source.type !== "character" || !target || target.type !== "character" || source.id === target.id ||
      !target.isOwner || source.isOwner || !source.testUserPermission(game.user, "OBSERVER") ||
      source.items.get(item?.id) !== item || !INCLUDED_ITEM_TYPES.has(item?.type) || Number(item.system?.quantity ?? 0) < 1) return notify("RequestInvalid");
  const mode = await foundry.applications.api.DialogV2.wait({
    window: {title: L("Request")},
    content: `<p>${esc(F("RequestPrompt", {item: item.name, source: source.name, target: target.name}))}</p>`,
    buttons: [
      {action:"take", label:L("Take"), callback:() => "take"},
      {action:"use", label:L("TakeUse"), callback:() => "use"},
      {action:"cancel", label:L("Cancel"), callback:() => null}
    ], rejectClose:false
  });
  if (!mode) return;
  // Re-check after the dialog: ownership and inventory could have changed.
  if (!target.isOwner || source.isOwner || !source.items.get(item.id) || Number(item.system?.quantity ?? 0) < 1) return notify("RequestInvalid");
  await ChatMessage.create({
    content: `<p>${esc(F("RequestText", {requester: game.user.name, item: item.name, source: source.name, target: target.name, mode: L(mode === "use" ? "TakeUse" : "Take")}))}</p>`,
    whisper: [...new Set([game.user.id, gm.id, ...owners.map(u => u.id), ...game.users.filter(u => u.isGM).map(u => u.id)])],
    flags: {[MODULE_ID]: {request: {kind:"request", sourceId:source.id, targetId:target.id, itemId:item.id, quantity:1, mode, status:"pending"}}}
  });
  ui.notifications.info(L("RequestSent"));
}

async function approve(message) {
  const r = resolveRequest(message);
  if (!r || r.data.status !== "pending" || game.user.isGM || !r.source.testUserPermission(game.user, "OWNER")) return notify("RequestInvalid");
  if (!activeGM()) return notify("NoGM");
  const accepted = await foundry.applications.api.DialogV2.confirm({
    window:{title:L("Approve")},
    content:`<p>${esc(F("ApprovePrompt", {item:r.item.name, source:r.source.name, target:r.target.name, requester:r.requester.name, mode:L(r.data.mode === "use" ? "TakeUse" : "Take")}))}</p>`,
    rejectClose:false, modal:true
  });
  if (!accepted) return;
  const again = resolveRequest(message);
  if (!again || again.data.status !== "pending" || !again.source.testUserPermission(game.user,"OWNER")) return notify("RequestInvalid");
  const snapshot = JSON.stringify([r.data.sourceId,r.data.targetId,r.data.itemId,r.data.quantity,r.data.mode,authorId(message)]);
  const current = JSON.stringify([again.data.sourceId,again.data.targetId,again.data.itemId,again.data.quantity,again.data.mode,authorId(message)]);
  if (snapshot !== current) return notify("RequestInvalid");
  await ChatMessage.create({
    content:`<p>${esc(F("ApprovedText", {owner:game.user.name, item:again.item.name, source:again.source.name, target:again.target.name}))}</p>`,
    whisper:[...new Set([game.user.id, again.requester.id, ...game.users.filter(u => u.isGM).map(u => u.id)])],
    flags:{[MODULE_ID]:{request:{kind:"approval",requestId:message.id,snapshot}}}
  });
  ui.notifications.info(L("ApprovedSent"));
}

async function execute(approval) {
  if (!game.user.isGM || activeGM()?.id !== game.user.id) return notify("ActiveGMOnly");
  const approvalData = flags(approval);
  const message = game.messages.get(approvalData?.requestId);
  const r = resolveRequest(message);
  const owner = game.users.get(authorId(approval));
  const snapshot = r && JSON.stringify([r.data.sourceId,r.data.targetId,r.data.itemId,r.data.quantity,r.data.mode,authorId(message)]);
  if (approvalData?.kind !== "approval" || !r || r.data.status !== "pending" || !owner || owner.isGM ||
      !r.source.testUserPermission(owner,"OWNER") || snapshot !== approvalData.snapshot || Number(r.item.system?.quantity ?? 0) < 1 || running.has(message.id)) return notify("RequestInvalid");
  running.add(message.id);
  try {
    const ok = await foundry.applications.api.DialogV2.confirm({window:{title:L("Execute")},
      content:`<p>${esc(F("ExecutePrompt", {owner:owner.name, item:r.item.name, source:r.source.name, target:r.target.name, requester:r.requester.name, mode:L(r.data.mode === "use" ? "TakeUse" : "Take")}))}</p><p>${esc(L("TransferWarning"))}</p>`, rejectClose:false, modal:true});
    if (!ok) return;
    const latest = resolveRequest(message);
    if (!latest || latest.data.status !== "pending" || !latest.source.testUserPermission(owner,"OWNER") ||
        JSON.stringify([latest.data.sourceId,latest.data.targetId,latest.data.itemId,latest.data.quantity,latest.data.mode,authorId(message)]) !== snapshot || Number(latest.item.system?.quantity ?? 0) < 1 || activeGM()?.id !== game.user.id) return notify("RequestInvalid");
    if (typeof latest.source.transferItemToActor !== "function") return notify("UnsupportedTransfer");
    // Mark before mutating: a failed or interrupted transfer requires manual reconciliation.
    await message.setFlag(MODULE_ID,"request",{...latest.data,status:"processing"});
    let transferred;
    try {
      transferred = await latest.source.transferItemToActor(latest.target, latest.item, 1, undefined, true, false);
      if (!transferred) throw new Error("System returned no transferred item");
    } catch (err) {
      console.error(`${MODULE_ID} | Transfer may be partial; inspect both inventories`,err);
      await message.setFlag(MODULE_ID,"request",{...latest.data,status:"failed"});
      return notify("TransferFailed");
    }
    await message.setFlag(MODULE_ID,"request",{...latest.data,status:"done"});
    await ChatMessage.create({
      content:`<p>${esc(F("TransferredText",{item:transferred.name, source:latest.source.name, target:latest.target.name}))} ${esc(latest.data.mode === "use" ? L("UseInstruction") : "")}</p>`,
      whisper:[...new Set([latest.requester.id,owner.id,game.user.id])],
      flags:{[MODULE_ID]:{request:{kind:"delivery", itemUuid:transferred.uuid, targetId:latest.target.id, recipientId:latest.requester.id, mode:latest.data.mode}}}
    });
  } finally { running.delete(message.id); }
}

/** Toolbelt does not expose its physical-item use function as a public API. When its
 * sheet button is relevant, defer to that button rather than duplicating its logic. */
export async function requiresToolbeltSheet(item) {
  if (item?.type !== "consumable" || !game.modules?.get("pf2e-toolbelt")?.active) return false;
  const toolbelt = game.toolbelt;
  try {
    if (typeof toolbelt?.getToolSetting !== "function") return true;
    if (toolbelt.getToolSetting("actionable", "use")) return true;
    if (!toolbelt.getToolSetting("actionable", "item")) return false;
    // Toolbelt's sheet button deliberately bypasses item macros for spell scrolls/wands.
    const category = item.category ?? item.system?.category;
    if (["scroll", "wand"].includes(category) && item.system?.spell) return false;
    const getMacro = toolbelt.api?.actionable?.getItemMacro;
    if (typeof getMacro !== "function") return true;
    return Boolean(await getMacro(item));
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not inspect Toolbelt settings; opening the sheet`, error);
    return true;
  }
}

async function useDelivery(message) {
  const data = flags(message);
  const gm = game.users.get(authorId(message));
  const target = game.actors.get(data?.targetId);
  const item = await fromUuid(data?.itemUuid ?? "");
  if (data?.kind !== "delivery" || data.mode !== "use" || !gm?.isGM || game.user.id !== data.recipientId || !target?.isOwner || item?.parent?.id !== target.id || typeof item?.consume !== "function") return notify("UseUnavailable");
  const toolbeltSheet = await requiresToolbeltSheet(item);
  const current = await fromUuid(data.itemUuid);
  if (!target.isOwner || !current || current.parent?.id !== target.id || typeof current.consume !== "function") return notify("UseUnavailable");
  if (toolbeltSheet) {
    if (typeof target.sheet?.render !== "function") return notify("UseUnavailable");
    await target.sheet.render(true);
    ui.notifications.info(F("ToolbeltUseSheet", {item:esc(current.name), target:esc(target.name)}), {permanent:true});
    return;
  }
  const quantity = Number(current.system?.quantity ?? current.quantity ?? 0);
  const uses = current.uses?.value ?? current.system?.uses?.value;
  if (quantity < 1 || (uses != null && Number(uses) <= 0)) return notify("UseUnavailable");
  const ok = await foundry.applications.api.DialogV2.confirm({window:{title:L("Use")}, content:`<p>${esc(F("UsePrompt",{item:current.name,target:target.name}))}</p>`,rejectClose:false, modal:true});
  if (!ok) return;
  const latest = await fromUuid(data.itemUuid);
  if (!target.isOwner || !latest || latest.parent?.id !== target.id || typeof latest.consume !== "function") return notify("UseUnavailable");
  // Settings may have changed while the dialog was open. Never bypass Toolbelt silently.
  if (await requiresToolbeltSheet(latest)) {
    if (typeof target.sheet?.render !== "function") return notify("UseUnavailable");
    await target.sheet.render(true);
    ui.notifications.info(F("ToolbeltUseSheet", {item:esc(latest.name), target:esc(target.name)}), {permanent:true});
    return;
  }
  const latestUses = latest.uses?.value ?? latest.system?.uses?.value;
  if (Number(latest.system?.quantity ?? latest.quantity ?? 0) < 1 || (latestUses != null && Number(latestUses) <= 0)) return notify("UseUnavailable");
  await latest.consume();
}

export function registerRequestHooks() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const data = flags(message);
    if (!data) return;
    const r = data.kind === "request" ? resolveRequest(message) : null;
    let label, handler;
    if (r && r.data.status === "pending" && !game.user.isGM && r.source.testUserPermission(game.user,"OWNER")) { label=L("Approve"); handler=approve; }
    else if (data.kind === "approval" && game.user.isGM && activeGM()?.id === game.user.id) { label=L("Execute"); handler=execute; }
    else if (data.kind === "delivery" && data.mode === "use" && data.recipientId === game.user.id && game.actors.get(data.targetId)?.isOwner && !game.user.isGM) { label=L("Use"); handler=useDelivery; }
    if (!handler) return;
    const button = document.createElement("button"); button.type="button"; button.textContent=label;
    button.addEventListener("click", async event => {
      event.preventDefault(); button.disabled=true;
      try { await handler(message); } catch (err) { console.error(`${MODULE_ID} | Request action failed`,err); ui.notifications.error(L("RequestError")); }
      finally { button.disabled=false; }
    });
    (html.querySelector(".message-content") ?? html).append(button);
  });
}
