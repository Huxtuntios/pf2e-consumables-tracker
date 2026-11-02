import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const modules = new Map();
class Collection extends Map { filter(fn) { return [...this.values()].filter(fn); } find(fn) { return [...this.values()].find(fn); } }
const hooks = {};
globalThis.Hooks = {on:(n,f)=>{(hooks[n]??=[]).push(f)}, once:()=>{}};
globalThis.ui={notifications:{warn:()=>{},info:()=>{},error:()=>{}}};
globalThis.CONST={TOKEN_DISPOSITIONS:{HOSTILE:-1,FRIENDLY:1,NEUTRAL:0}};
globalThis.CONFIG={PF2E:{},SF2E:{}};
globalThis.document={createElement:()=>({addEventListener(_n,cb){this.click=cb;},disabled:false})};
let dialogResult='take';
globalThis.foundry={applications:{api:{ApplicationV2:class {render(){}}, HandlebarsApplicationMixin: Base => Base, DialogV2:{wait:async()=>dialogResult, confirm:async()=>true}}}};
const users=new Collection(), actors=new Collection(), messages=new Collection();
const gm={id:'gm',name:'GM',isGM:true,active:true}, alice={id:'alice',name:'Alice',active:true}, bob={id:'bob',name:'Bob',active:true};
for(const u of [gm,alice,bob]) users.set(u.id,u); users.activeGM=gm;
const values={ignoreContainerItems:false,restrictPlayerView:false,shareCombatAllies:false,blacklist:[],lastFilters:{}};
globalThis.game={user:alice,users,actors,messages,combats:{active:null},system:{id:'pf2e'},i18n:{localize:k=>k,has:()=>false,format:(k,v)=>`${k} ${JSON.stringify(v)}`},settings:{get:(_m,k)=>values[k],set:()=>{}}};
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
test('GM sees only hostile NPC combatants with toggle; never arbitrary scene tokens',async()=>{
 const npc={...actor('npc','nobody'),type:'npc',uuid:'Scene.test.Token.one.Actor.npc'};
 npc.items=new Collection([['n',{...item,id:'n',uuid:'Scene.test.Token.one.Actor.npc.Item.n',parent:npc}]]);
 const token={name:'Enemy',disposition:-1,actor:npc};
 canvas.tokens.placeables=[{actor:npc,document:token}];
 game.combats.active={id:'battle',active:true,combatants:[]};game.user=gm;
 let app=new App();let ctx=await app._prepareContext({});assert.equal(ctx.totalCount,2);
 app.filters.showEnemies=true;ctx=await app._prepareContext({});assert.equal(ctx.totalCount,2,'outside combat');
 game.combats.active.combatants=[{actor:npc,token},{actor:npc,token}];
 ctx=await app._prepareContext({});assert.equal(ctx.totalCount,3,'deduplicated');
 game.user=alice;ctx=await app._prepareContext({});assert.equal(ctx.totalCount,2,'no enemies for players');
 game.combats.active=null;
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

test('combat NPC selection excludes scene-only, wrong disposition, neutral, hidden and duplicates',async()=>{
 const {getCombatNPCs}=await import('../scripts/combat-consumables.mjs');
 const a={...actor('friend','nobody'),type:'npc'}, b={...actor('hidden','nobody'),type:'npc'}, c={...actor('hostile','nobody'),type:'npc'}, d={...actor('neutral','nobody'),type:'npc'};
 const ct=(actor,disposition,hidden=false)=>({actor,hidden,token:{name:actor.name,disposition,hidden:false}});
 const combat={active:true,combatants:[ct(a,1),ct(a,1),ct(b,1,true),ct(c,-1),ct(d,0),ct(target,1)]};
 assert.deepEqual(getCombatNPCs(combat,1,{excludeHidden:true}).map(x=>x.actor.id),['friend']);
 assert.deepEqual(getCombatNPCs(combat,-1).map(x=>x.actor.id),['hostile']);
 combat.active=false;assert.equal(getCombatNPCs(combat,1).length,0);
});
test('GM shares only visible identified allied combatant data with opt-in and filters',async()=>{
 const {buildSharedCombatAllies}=await import('../scripts/combat-consumables.mjs');
 const a={...actor('ally','nobody'),type:'npc',uuid:'Actor.ally',items:new Collection()};
 const potion={...item,id:'known',name:'Ally potion',parent:a,isIdentified:true,system:{...item.system,quantity:2}};
 const unidentified={...potion,id:'secret',name:'Secret',isIdentified:false};
 const container={...potion,id:'bagged',name:'Bagged',system:{...potion.system,containerId:'bag'}};
 a.items.set('known',potion);a.items.set('secret',unidentified);a.items.set('bagged',container);
 const token={name:'Ally token',disposition:1,hidden:false,actor:a};
 game.combats.active={id:'battle',active:true,combatants:[{actor:a,token}]};game.user=gm;
 values.ignoreContainerItems=true;values.shareCombatAllies=false;assert.deepEqual(buildSharedCombatAllies({combatId:'battle'}),[]);
 values.shareCombatAllies=true;let items=buildSharedCombatAllies({combatId:'battle'});assert.equal(items.length,1);assert.equal(items[0].name,'Ally potion');assert.equal(items[0].actorName,'Ally token');assert.equal(items[0].canRequest,false);assert.equal(items[0].canOpen,false);assert.equal('uuid' in items[0],false);
 values.blacklist=['ally potion'];assert.equal(buildSharedCombatAllies({combatId:'battle'}).length,0);values.blacklist=[];
 token.hidden=true;assert.equal(buildSharedCombatAllies({combatId:'battle'}).length,0);token.hidden=false;
 game.combats.active.combatants[0].hidden=true;assert.equal(buildSharedCombatAllies({combatId:'battle'}).length,0);game.combats.active.combatants[0].hidden=false;
 assert.equal(buildSharedCombatAllies({combatId:'other'}).length,0);game.user=alice;assert.equal(buildSharedCombatAllies({combatId:'battle'}).length,0);
 values.ignoreContainerItems=false;values.shareCombatAllies=false;game.combats.active=null;
});
test('player views opted-in GM data without NPC document access and setting disables it',async()=>{
 const {buildSharedCombatAllies}=await import('../scripts/combat-consumables.mjs');
 const a={...actor('ally2','nobody'),type:'npc',uuid:'Actor.ally2',items:new Collection(),testUserPermission:()=>false};
 a.items.set('known',{...item,id:'known',name:'Elixir',parent:a,isIdentified:true});
 const token={name:'Ally',disposition:1,hidden:false,actor:a};game.combats.active={id:'battle',active:true,combatants:[{actor:a,token}]};values.shareCombatAllies=true;
 gm.query=async (_query,data)=>{const old=game.user;game.user=gm;const answer=buildSharedCombatAllies(data);game.user=old;return answer};
 game.user=alice;const app=new App();let context=await app._prepareContext({});assert.equal(context.totalCount,3);assert.equal(context.groups.flatMap(g=>g.items).find(i=>i.name==='Elixir').canOpen,false);
 values.shareCombatAllies=false;context=await app._prepareContext({});assert.equal(context.totalCount,2);
 delete gm.query;game.combats.active=null;
});
test('missing GM or permission is reported; stale reply discarded',async()=>{
 const {querySharedCombatAllies}=await import('../scripts/combat-consumables.mjs');game.user=alice;values.shareCombatAllies=true;game.combats.active={id:'old',active:true};
 users.activeGM=null;assert.equal((await querySharedCombatAllies()).error,true);users.activeGM=gm;
 gm.query=async()=>{game.combats.active={id:'new',active:true};return [{name:'stale'}]};assert.deepEqual((await querySharedCombatAllies()).items,[]);
 gm.query=async()=>{values.shareCombatAllies=false;return [{name:'stale'}]};assert.deepEqual((await querySharedCombatAllies()).items,[]);
 delete gm.query;game.combats.active=null;values.shareCombatAllies=false;
});

test('independent unlinked combat NPCs are distinct; disabling invalidates an in-flight reply',async()=>{
 const {getCombatNPCs}=await import('../scripts/combat-consumables.mjs');
 const one={...actor('npc','none'),type:'npc',uuid:'Scene.s.Token.one.Actor.a'};
 const two={...one,uuid:'Scene.s.Token.two.Actor.a'};
 const combat={id:'battle',active:true,combatants:[{actor:one,token:{disposition:-1}},{actor:two,token:{disposition:-1}}]};
 assert.equal(getCombatNPCs(combat,-1).length,2);
 game.combats.active=combat;values.shareCombatAllies=true;game.user=alice;
 let respond;gm.query=()=>new Promise(r=>respond=r);const app=new App();const pending=app._prepareContext({});
 values.shareCombatAllies=false;respond([{name:'should not show',actorName:'Ally',traits:[],category:'potion'}]);
 const ctx=await pending;assert.equal(ctx.totalCount,2);
 delete gm.query;game.combats.active=null;
});
