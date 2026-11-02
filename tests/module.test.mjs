import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const modules = new Map();
class Collection extends Map { filter(fn) { return [...this.values()].filter(fn); } find(fn) { return [...this.values()].find(fn); } }
const hooks = {};
globalThis.Hooks = {on:(n,f)=>{(hooks[n]??=[]).push(f)}, once:()=>{}};
globalThis.ui={notifications:{warn:()=>{},info:()=>{},error:()=>{}}};
globalThis.CONST={TOKEN_DISPOSITIONS:{HOSTILE:-1}};
globalThis.CONFIG={PF2E:{},SF2E:{}};
globalThis.document={createElement:()=>({addEventListener(_n,cb){this.click=cb;},disabled:false})};
let dialogResult='take';
globalThis.foundry={applications:{api:{ApplicationV2:class {render(){}}, HandlebarsApplicationMixin: Base => Base, DialogV2:{wait:async()=>dialogResult, confirm:async()=>true}}}};
const users=new Collection(), actors=new Collection(), messages=new Collection();
const gm={id:'gm',name:'GM',isGM:true,active:true}, alice={id:'alice',name:'Alice',active:true}, bob={id:'bob',name:'Bob',active:true};
for(const u of [gm,alice,bob]) users.set(u.id,u); users.activeGM=gm;
const values={ignoreContainerItems:false,restrictPlayerView:false,blacklist:[],lastFilters:{}};
globalThis.game={user:alice,users,actors,messages,system:{id:'pf2e'},i18n:{localize:k=>k,has:()=>false,format:(k,v)=>`${k} ${JSON.stringify(v)}`},settings:{get:(_m,k)=>values[k],set:()=>{}}};
function actor(id, owner) { const a={id, uuid:`Actor.${id}`,name:id,type:'character',hasPlayerOwner:true,items:new Collection(),testUserPermission(u,p){return p==='OBSERVER'||u.id===owner||u.isGM}, get isOwner(){return game.user.id===owner||game.user.isGM}}; return a; }
const source=actor('source','bob'), target=actor('target','alice'); actors.set(source.id,source); actors.set(target.id,target); alice.character=target;
const item={id:'item',uuid:'Actor.source.Item.item',name:'Potion <test>',type:'consumable',system:{quantity:2,category:'potion',level:{value:1},traits:{value:[]}},parent:source};source.items.set(item.id,item);
let transferred=0, consumed=0;
source.transferItemToActor=async (dest,it,qty,_container,newStack,isPurchase)=>{assert.equal(qty,1);assert.equal(newStack,true);assert.equal(isPurchase,false);transferred++; it.system.quantity--;const copy={...it,id:'copy',uuid:'Actor.target.Item.copy',parent:dest,system:{...it.system,quantity:1},consume:async()=>{consumed++}};dest.items.set(copy.id,copy);return copy;};
globalThis.fromUuid=async uuid=>{for(const a of actors.values()) for(const i of a.items.values()) if(i.uuid===uuid)return i; return null};
globalThis.fromUuidSync=()=>null;
globalThis.canvas={ready:true,tokens:{placeables:[]}};
globalThis.ChatMessage={create:async data=>{const m={id:String(messages.size+1),author:game.user, content:data.content,whisper:data.whisper,flags:data.flags,getFlag:(namespace,key)=>m.flags?.[namespace]?.[key],setFlag:async(namespace,key,val)=>{m.flags[namespace][key]=val}};messages.set(m.id,m);return m}};
let createRequest, Data, App;
before(async()=>{({createRequest,registerRequestHooks:modules.register}=await import('../scripts/requests.mjs')); modules.register(); Data=await import('../scripts/data/consumables-data.mjs'); ({ConsumablesTrackerApp:App}=await import('../scripts/apps/consumables-tracker-app.mjs'));});
function action(message){const html={querySelector:()=>({append:(button)=>{html.button=button}})};hooks.renderChatMessageHTML[0](message,html);return html.button;}
async function click(button){assert.ok(button);await button.click({preventDefault(){}})}

test('request, approval, active GM transfer and recipient use; no replay',async()=>{
 game.user=alice;dialogResult='use';await createRequest(item.uuid,target.id);const request=messages.get('1');assert.ok(request);assert.match(request.content,/&lt;test&gt;/);assert.deepEqual(new Set(request.whisper),new Set(['alice','bob','gm']));
 assert.equal(action(request),undefined);game.user=bob;await click(action(request));const approval=messages.get('2');assert.ok(approval);assert.equal(transferred,0);
 game.user=gm;await click(action(approval));assert.equal(transferred,1);assert.equal(request.getFlag('pf2e-consumables-tracker','request').status,'done');
 await click(action(approval));assert.equal(transferred,1);const delivery=messages.get('3');game.user=bob;assert.equal(action(delivery),undefined);game.user=alice;await click(action(delivery));assert.equal(consumed,1);
});
test('reject forged or changed request and missing owner / GM',async()=>{
 messages.clear(); game.user=alice; dialogResult='take'; await createRequest(item.uuid,target.id);let req=messages.get('1');game.user=bob;await click(action(req));const approval=messages.get('2');req.flags['pf2e-consumables-tracker'].request.mode='use';game.user=gm;await click(action(approval));assert.equal(transferred,1);
 messages.clear();users.activeGM=null;game.user=alice;await createRequest(item.uuid,target.id);assert.equal(messages.size,0); users.activeGM=gm; bob.active=false;await createRequest(item.uuid,target.id);assert.equal(messages.size,0);bob.active=true;
});
test('system error locks request rather than retrying',async()=>{
 messages.clear();game.user=alice;await createRequest(item.uuid,target.id);const req=messages.get('1');game.user=bob;await click(action(req));const approval=messages.get('2'); const old=source.transferItemToActor;source.transferItemToActor=async()=>{throw Error('simulated')};game.user=gm;await click(action(approval));assert.equal(req.getFlag('pf2e-consumables-tracker','request').status,'failed');source.transferItemToActor=old;await click(action(approval));assert.equal(transferred,1);
});
test('filters and categories; safe special grouping keys',()=>{
 game.user=alice;const rows=Data.getActorConsumables(source,{blacklist:[],ignoreContainerItems:false});assert.equal(rows.length,1);assert.equal(rows[0].canRequest,true);assert.equal(Data.getActorConsumables(source,{blacklist:['potion <test>'],ignoreContainerItems:false}).length,0);assert.equal(Data.groupConsumables([{category:'__proto__'}],'category')['__proto__'].length,1);
});
test('GM sees hostile scene NPC only with toggle; player cannot see it',async()=>{
 const npc={...actor('npc','nobody'),type:'npc',uuid:'Scene.test.Token.one.Actor.npc'};npc.items=new Collection([['n',{...item,id:'n',uuid:'Scene.test.Token.one.Actor.npc.Item.n',parent:npc}]]);canvas.tokens.placeables=[{actor:npc,document:{disposition:-1}},{actor:npc,document:{disposition:-1}}];game.user=gm;let app=new App();let ctx=await app._prepareContext({});assert.equal(ctx.totalCount,2);app.filters.showEnemies=true;ctx=await app._prepareContext({});assert.equal(ctx.totalCount,3);game.user=alice;ctx=await app._prepareContext({});assert.equal(ctx.totalCount,2);
});
test('manifest assets exist and localization keys match',async()=>{
 const manifest=JSON.parse(await readFile('module.json'));assert.equal(manifest.id,'pf2e-consumables-tracker');for(const f of [...manifest.esmodules,...manifest.styles,...manifest.languages.map(l=>l.path)]) await readFile(f);
 const en=JSON.parse(await readFile('lang/en.json'));const ru=JSON.parse(await readFile('lang/ru.json'));function paths(x,p=''){return Object.entries(x).flatMap(([k,v])=>typeof v==='object'?paths(v,p+k+'.'):[p+k]).sort()};assert.deepEqual(paths(en),paths(ru));
});

test('SF2e ammo is tracked and containers and blacklist are respected',()=>{
 game.system.id='sf2e';game.user=alice;const ammo={id:'ammo',uuid:'Actor.source.Item.ammo',name:'Cells',type:'ammo',parent:source,system:{quantity:5,category:'ammo',containerId:'bag',traits:{value:['energy']}}};source.items.set(ammo.id,ammo);
 assert.equal(Data.getActorConsumables(source,{ignoreContainerItems:true,blacklist:[]}).some(x=>x.id==='ammo'),false);
 assert.equal(Data.getActorConsumables(source,{ignoreContainerItems:false,blacklist:[]}).some(x=>x.id==='ammo'),true);
 assert.equal(Data.getActorConsumables(source,{ignoreContainerItems:false,blacklist:['CELLS']}).some(x=>x.id==='ammo'),false);
 source.items.delete(ammo.id);game.system.id='pf2e';
});
test('request destination must belong to requester',async()=>{
 messages.clear();game.user=alice;await createRequest(item.uuid,source.id);assert.equal(messages.size,0);
});

test('Toolbelt setting and linked macro routing matrix', async()=>{
 const {requiresToolbeltSheet}=await import('../scripts/requests.mjs');
 game.modules=new Collection([['pf2e-toolbelt',{active:true}]]);
 let options={use:true,item:false}; let macro=null;
 game.toolbelt={getToolSetting:(_group,k)=>options[k],api:{actionable:{getItemMacro:async()=>macro}}};
 const normal={type:'consumable',category:'potion',system:{}};
 for (const system of ['pf2e','sf2e']) {
  game.system.id=system;
  assert.equal(await requiresToolbeltSheet(normal),true,'Use Consumable');
  options={use:false,item:true}; macro={name:'linked macro'};
  assert.equal(await requiresToolbeltSheet(normal),true,'Item Macro linked');
  assert.equal(await requiresToolbeltSheet({...normal,category:'wand',system:{spell:{}}}),false,'cast wand bypasses macro as Toolbelt does');
  assert.equal(await requiresToolbeltSheet({...normal,category:'scroll',system:{spell:{}}}),false,'cast scroll bypasses macro as Toolbelt does');
  macro=null;assert.equal(await requiresToolbeltSheet(normal),false,'Item Macro enabled but no macro');
  options={use:false,item:false};assert.equal(await requiresToolbeltSheet(normal),false,'both disabled');
  options.use=true;assert.equal(await requiresToolbeltSheet({type:'ammo'}),false,'Toolbelt does not add ammo button');
 }
 game.system.id='pf2e'; game.toolbelt={};assert.equal(await requiresToolbeltSheet(normal),true,'unknown API is fail-safe');
 game.modules.get('pf2e-toolbelt').active=false;assert.equal(await requiresToolbeltSheet(normal),false,'module inactive');
 delete game.toolbelt;game.modules.clear();
});
test('Toolbelt use opens the sheet without consuming; user setting evaluated on recipient',async()=>{
 messages.clear();game.modules=new Collection([['pf2e-toolbelt',{active:true}]]);let opened=0;target.sheet={render:async()=>{opened++}};
 game.toolbelt={getToolSetting:(_g,k)=>k==='use',api:{actionable:{getItemMacro:async()=>null}}};
 const received=target.items.get('copy');game.user=gm;
 const msg=await ChatMessage.create({content:'delivery',whisper:['alice'],flags:{'pf2e-consumables-tracker':{request:{kind:'delivery',itemUuid:received.uuid,targetId:'target',recipientId:'alice',mode:'use'}}}});
 game.user=alice;const prior=consumed;await click(action(msg));assert.equal(opened,1);assert.equal(consumed,prior);
 game.modules.clear();delete game.toolbelt;
});
test('empty consumable is never consumed',async()=>{
 messages.clear();game.modules=new Collection(); const received=target.items.get('copy');received.system.uses={value:0};game.user=gm;
 const msg=await ChatMessage.create({content:'delivery',whisper:['alice'],flags:{'pf2e-consumables-tracker':{request:{kind:'delivery',itemUuid:received.uuid,targetId:'target',recipientId:'alice',mode:'use'}}}});
 game.user=alice;const prior=consumed;await click(action(msg));assert.equal(consumed,prior);delete received.system.uses;
});

test('settings changed during confirmation do not bypass Toolbelt',async()=>{
 messages.clear();game.modules=new Collection([['pf2e-toolbelt',{active:true}]]);let enabled=false,opened=0;target.sheet={render:async()=>{opened++}};
 game.toolbelt={getToolSetting:(_g,k)=>k==='use'&&enabled,api:{actionable:{getItemMacro:async()=>null}}};
 const received=target.items.get('copy');game.user=gm;
 const msg=await ChatMessage.create({content:'delivery',whisper:['alice'],flags:{'pf2e-consumables-tracker':{request:{kind:'delivery',itemUuid:received.uuid,targetId:'target',recipientId:'alice',mode:'use'}}}});
 game.user=alice;const old=foundry.applications.api.DialogV2.confirm;foundry.applications.api.DialogV2.confirm=async()=>{enabled=true;return true};const prior=consumed;
 await click(action(msg));assert.equal(opened,1);assert.equal(consumed,prior);
 foundry.applications.api.DialogV2.confirm=old;game.modules.clear();delete game.toolbelt;
});
