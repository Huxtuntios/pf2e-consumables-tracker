import { MODULE_ID, INCLUDED_ITEM_TYPES } from "./constants.mjs";
import { useConsumable } from "./use-consumable.mjs";

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

// Decisions are owner-authored chat messages: owners cannot mutate a requester's message.
const requestSnapshot = r => JSON.stringify([r.data.sourceId, r.data.targetId, r.data.itemId, r.data.quantity, r.data.mode, authorId(r.message)]);
function resolvedWithMessage(message) {
  const r = resolveRequest(message);
  return r ? {...r, message} : null;
}
function decisionFor(message, r = resolvedWithMessage(message)) {
  if (!r) return null;
  const snapshot = requestSnapshot(r);
  for (const entry of game.messages) {
    const decision = Array.isArray(entry) ? entry[1] : entry;
    const data = flags(decision), owner = game.users.get(authorId(decision));
    if (["approval", "decline"].includes(data?.kind) && data.requestId === message.id &&
        data.snapshot === snapshot && owner && !owner.isGM && r.source.testUserPermission(owner, "OWNER")) return decision;
  }
  return null;
}
function requestStatus(message) {
  const data = flags(message);
  if (data?.kind !== "request") return "Unknown";
  if (data.status === "processing") return "Processing";
  if (data.status === "done") return "Done";
  if (data.status === "failed") return "Failed";
  const r = resolvedWithMessage(message);
  if (!r || data.status !== "pending") return "Unknown";
  const decision = decisionFor(message, r);
  return !decision ? "Pending" : flags(decision).kind === "decline" ? "Declined" : "Approved";
}
const participants = r => [...new Set([r.requester.id, ...game.users.filter(u => u.isGM || r.source.testUserPermission(u, "OWNER")).map(u => u.id)])];

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
    content: `<p>${esc(F("RequestPrompt", {item: item.name, source: source.name, target: target.name}))}</p><p>${esc(L("RequestFlow"))}</p>`,
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
  if (!r || requestStatus(message) !== "Pending" || game.user.isGM || !r.source.testUserPermission(game.user, "OWNER")) return notify("RequestInvalid");
  if (!activeGM()) return notify("NoGM");
  const accepted = await foundry.applications.api.DialogV2.confirm({
    window:{title:L("Approve")},
    content:`<p>${esc(F("ApprovePrompt", {item:r.item.name, source:r.source.name, target:r.target.name, requester:r.requester.name, mode:L(r.data.mode === "use" ? "TakeUse" : "Take")}))}</p>`,
    rejectClose:false, modal:true
  });
  if (!accepted) return;
  const again = resolveRequest(message);
  if (!again || requestStatus(message) !== "Pending" || !again.source.testUserPermission(game.user,"OWNER")) return notify("RequestInvalid");
  const snapshot = JSON.stringify([r.data.sourceId,r.data.targetId,r.data.itemId,r.data.quantity,r.data.mode,authorId(message)]);
  const current = JSON.stringify([again.data.sourceId,again.data.targetId,again.data.itemId,again.data.quantity,again.data.mode,authorId(message)]);
  if (snapshot !== current) return notify("RequestInvalid");
  await ChatMessage.create({
    content:`<p>${esc(F("ApprovedText", {owner:game.user.name, item:again.item.name, source:again.source.name, target:again.target.name}))}</p>`,
    whisper:participants(again),
    flags:{[MODULE_ID]:{request:{kind:"approval",requestId:message.id,snapshot}}}
  });
  ui.notifications.info(L("ApprovedSent"));
}

async function decline(message) {
  const r = resolvedWithMessage(message);
  if (!r || requestStatus(message) !== "Pending" || game.user.isGM || !r.source.testUserPermission(game.user, "OWNER")) return notify("RequestInvalid");
  const snapshot = requestSnapshot(r);
  const ok = await foundry.applications.api.DialogV2.confirm({window:{title:L("Decline")},
    content:`<p>${esc(F("DeclinePrompt", {item:r.item.name, requester:r.requester.name}))}</p>`, rejectClose:false, modal:true});
  const current = resolvedWithMessage(message);
  if (!ok) return;
  if (!current || requestStatus(message) !== "Pending" || !current.source.testUserPermission(game.user, "OWNER") || requestSnapshot(current) !== snapshot) return notify("RequestInvalid");
  await ChatMessage.create({
    content:`<p>${esc(F("DeclinedText", {owner:game.user.name, item:current.item.name, source:current.source.name, target:current.target.name}))}</p>`,
    whisper:participants(current),
    flags:{[MODULE_ID]:{request:{kind:"decline", requestId:message.id, snapshot}}}
  });
  ui.notifications.info(L("DeclinedSent"));
}

async function execute(approval) {
  if (!game.user.isGM || activeGM()?.id !== game.user.id) return notify("ActiveGMOnly");
  const approvalData = flags(approval);
  const message = game.messages.get(approvalData?.requestId);
  const r = resolveRequest(message);
  const owner = game.users.get(authorId(approval));
  const snapshot = r && JSON.stringify([r.data.sourceId,r.data.targetId,r.data.itemId,r.data.quantity,r.data.mode,authorId(message)]);
  if (approvalData?.kind !== "approval" || !r || r.data.status !== "pending" || !owner || owner.isGM ||
      !r.source.testUserPermission(owner,"OWNER") || snapshot !== approvalData.snapshot || decisionFor(message)?.id !== approval.id || Number(r.item.system?.quantity ?? 0) < 1 || running.has(message.id)) return notify("RequestInvalid");
  running.add(message.id);
  try {
    const ok = await foundry.applications.api.DialogV2.confirm({window:{title:L("Execute")},
      content:`<p>${esc(F("ExecutePrompt", {owner:owner.name, item:r.item.name, source:r.source.name, target:r.target.name, requester:r.requester.name, mode:L(r.data.mode === "use" ? "TakeUse" : "Take")}))}</p><p>${esc(L("TransferWarning"))}</p>`, rejectClose:false, modal:true});
    if (!ok) return;
    const latest = resolveRequest(message);
    if (!latest || latest.data.status !== "pending" || !latest.source.testUserPermission(owner,"OWNER") || decisionFor(message)?.id !== approval.id ||
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

async function useDelivery(message, event) {
  const data = flags(message);
  const gm = game.users.get(authorId(message));
  const target = game.actors.get(data?.targetId);
  const item = await fromUuid(data?.itemUuid ?? "");
  if (data?.kind !== "delivery" || data.mode !== "use" || !gm?.isGM || game.user.id !== data.recipientId || !target?.isOwner || item?.parent?.id !== target.id) return notify("UseUnavailable");
  // Same routing as the tracker's Use button, including PF2e Toolbelt settings and item macros.
  await useConsumable(item, {event});
}

export function registerRequestHooks() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const data = flags(message);
    if (!data) return;
    const request = data.kind === "request" ? message : ["approval", "decline"].includes(data.kind) ? game.messages.get(data.requestId) : null;
    const status = request ? requestStatus(request) : data.kind === "delivery" ? "Done" : "Unknown";
    const container = html.querySelector(".message-content") ?? html;
    const statusLine = document.createElement("p");
    statusLine.className = "pct-request-status";
    statusLine.textContent = F("StatusLabel", {status:L(`Status${status}`)});
    container.append(statusLine);
    const r = data.kind === "request" ? resolveRequest(message) : null;
    const buttons = [];
    if (r && status === "Pending" && !game.user.isGM && r.source.testUserPermission(game.user,"OWNER")) {
      buttons.push([L("Approve"), approve], [L("Decline"), decline]);
    } else if (data.kind === "approval" && status === "Approved" && game.user.isGM && activeGM()?.id === game.user.id && decisionFor(request)?.id === message.id) {
      buttons.push([L("Execute"), execute]);
    } else if (data.kind === "delivery" && data.mode === "use" && data.recipientId === game.user.id && game.actors.get(data.targetId)?.isOwner && !game.user.isGM) {
      buttons.push([L("Use"), useDelivery]);
    }
    for (const [label, handler] of buttons) {
      const button = document.createElement("button"); button.type="button"; button.textContent=label;
      button.addEventListener("click", async event => {
        event.preventDefault(); button.disabled=true;
        try { await handler(message, event); } catch (err) { console.error(`${MODULE_ID} | Request action failed`,err); ui.notifications.error(L("RequestError")); }
        finally { button.disabled=false; }
      });
      container.append(button);
    }
  });
  // Chat status is derived from separate messages. Refresh visible related cards locally.
  const refreshCards = message => {
    const data = flags(message);
    const requestId = data?.kind === "request" ? message.id : ["approval", "decline"].includes(data?.kind) ? data.requestId : null;
    if (!requestId || typeof ui.chat?.updateMessage !== "function") return;
    setTimeout(() => {
      for (const entry of game.messages) {
        const card = Array.isArray(entry) ? entry[1] : entry;
        const cardData = flags(card);
        if (card.id === requestId || cardData?.requestId === requestId) {
          Promise.resolve(ui.chat.updateMessage(card, {notify:false})).catch(error => console.warn(`${MODULE_ID} | Could not refresh request card`, error));
        }
      }
    }, 0);
  };
  Hooks.on("createChatMessage", refreshCards);
  Hooks.on("updateChatMessage", refreshCards);
}
