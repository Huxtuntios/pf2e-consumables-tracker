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
globalThis.document={createElement:tag=>tag==='div'?{innerHTML:'',querySelector:()=>null,get outerHTML(){return `<div>${this.innerHTML}</div>`}}:({tagName:tag.toUpperCase(),addEventListener(_n,cb){this.click=cb;},disabled:false})};
let dialogResult='take';
globalThis.foundry={applications:{api:{ApplicationV2:class {render(){} _onRender(){} _onClose(){}}, HandlebarsApplicationMixin: Base => Base, DialogV2:{wait:async()=>dialogResult, confirm:async()=>true}}}};
const users=new Collection(), actors=new Collection(), messages=new Collection();
const gm={id:'gm',name:'GM',isGM:true,active:true}, alice={id:'alice',name:'Alice',active:true}, bob={id:'bob',name:'Bob',active:true};
for(const u of [gm,alice,bob]) users.set(u.id,u); users.activeGM=gm;
const values={confirmUse:true,ignoreContainerItems:false,restrictPlayerView:false,shareCombatAllies:false,blacklist:[],lastFilters:{}};
globalThis.game={user:alice,users,actors,messages,combats:{active:null},system:{id:'pf2e'},i18n:{localize:k=>k,has:()=>false,format:(k,v)=>`${k} ${JSON.stringify(v)}`},settings:{get:(_m,k)=>values[k],set:async (_m,k,v)=>{values[k]=v}}};
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
function action(message, index=0){const nodes=[];const html={querySelector:()=>({append:(node)=>nodes.push(node)})};hooks.renderChatMessageHTML[0](message,html);return nodes.filter(node=>node.tagName==='BUTTON')[index];}
function statusText(message){const nodes=[];const html={querySelector:()=>({append:node=>nodes.push(node)})};hooks.renderChatMessageHTML[0](message,html);return nodes.find(n=>n.className==='pct-request-status')?.textContent;}
async function click(button){assert.ok(button);await button.click({preventDefault(){}})}

test('request, approval, active GM transfer and recipient use; no replay',async()=>{
 game.user=alice;dialogResult='use';await createRequest(item.uuid,target.id);const request=messages.get('1');assert.ok(request);assert.match(request.content,/&lt;test&gt;/);assert.deepEqual(new Set(request.whisper),new Set(['alice','bob','gm']));
 assert.equal(action(request),undefined);game.user=bob;await click(action(request));const approval=messages.get('2');assert.ok(approval);assert.equal(transferred,0);
 game.user=gm;await click(action(approval));assert.equal(transferred,1);assert.equal(request.getFlag('pf2e-consumables-tracker','request').status,'done');
 assert.equal(action(approval),undefined);assert.equal(transferred,1);const delivery=messages.get('3');game.user=bob;assert.equal(action(delivery),undefined);game.user=alice;await click(action(delivery));assert.equal(consumed,1);
});
test('reject forged or changed request and missing owner / GM',async()=>{
 messages.clear(); game.user=alice; dialogResult='take'; await createRequest(item.uuid,target.id);let req=messages.get('1');game.user=bob;await click(action(req));const approval=messages.get('2');req.flags['pf2e-consumables-tracker'].request.mode='use';game.user=gm;assert.equal(action(approval),undefined);assert.equal(transferred,1);
 messages.clear();users.activeGM=null;game.user=alice;await createRequest(item.uuid,target.id);assert.equal(messages.size,0); users.activeGM=gm; bob.active=false;await createRequest(item.uuid,target.id);assert.equal(messages.size,0);bob.active=true;
});
test('system error locks request rather than retrying',async()=>{
 messages.clear();game.user=alice;await createRequest(item.uuid,target.id);const req=messages.get('1');game.user=bob;await click(action(req));const approval=messages.get('2'); const old=source.transferItemToActor;source.transferItemToActor=async()=>{throw Error('simulated')};game.user=gm;await click(action(approval));assert.equal(req.getFlag('pf2e-consumables-tracker','request').status,'failed');source.transferItemToActor=old;assert.equal(action(approval),undefined);assert.equal(transferred,1);
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

test('empty consumable is never consumed',async()=>{
 messages.clear();game.modules=new Collection(); const received=target.items.get('copy');received.system.uses={value:0};game.user=gm;
 const msg=await ChatMessage.create({content:'delivery',whisper:['alice'],flags:{'pf2e-consumables-tracker':{request:{kind:'delivery',itemUuid:received.uuid,targetId:'target',recipientId:'alice',mode:'use'}}}});
 game.user=alice;const prior=consumed;await click(action(msg));assert.equal(consumed,prior);delete received.system.uses;
});

function usable(owner, extra={}) {
 const a=actor(`use-${Math.random()}`,owner); actors.set(a.id,a);
 const log={consume:0,update:[],deleted:0,chat:0};
 const it={id:'u',uuid:`${a.uuid}.Item.u`,name:'Healing Potion',type:'consumable',parent:a,actor:a,category:'potion',
  system:{quantity:2,category:'potion',uses:{value:1,max:1,autoDestroy:true},level:{value:1},traits:{value:[]}},
  consume:async()=>{log.consume++},update:async d=>{log.update.push(d)},delete:async()=>{log.deleted++},toMessage:async()=>({content:'<p>card</p>'}),...extra};
 a.items.set(it.id,it); return {a,it,log};
}
const purgeUsable=()=>{for(const id of [...actors.keys()]) if(id.startsWith('use-')) actors.delete(id)};
async function withToolbelt(settings, macro, fn){
 const oldCreate=ChatMessage.create, oldSpeaker=ChatMessage.getSpeaker; let chats=0;
 ChatMessage.getSpeaker=()=>({}); ChatMessage.create=async()=>{chats++};
 game.modules=new Collection([['pf2e-toolbelt',{active:true}]]);
 game.toolbelt={getToolSetting:(_g,k)=>Boolean(settings[k]),api:{actionable:{getItemMacro:async()=>macro}}};
 game.i18n.format=(k,v)=>`${k} ${JSON.stringify(v)}`;
 try { await fn(()=>chats); } finally { ChatMessage.create=oldCreate; ChatMessage.getSpeaker=oldSpeaker; game.modules.clear(); delete game.toolbelt; }
}
test('tracker use: system consume without Toolbelt, only for owners, never when empty',async()=>{
 const {useConsumable}=await import('../scripts/use-consumable.mjs');
 game.modules=new Collection();game.user=alice;
 let {it,log}=usable('alice'); assert.equal(await useConsumable(it),true); assert.equal(log.consume,1);
 ({it,log}=usable('bob')); assert.equal(await useConsumable(it),false); assert.equal(log.consume,0,'not owner');
 ({it,log}=usable('alice')); it.system.uses.value=0; assert.equal(await useConsumable(it),false); assert.equal(log.consume,0,'no charges');
 ({it,log}=usable('alice')); it.system.quantity=0; assert.equal(await useConsumable(it),false,'no quantity');
 ({it,log}=usable('alice',{type:'ammo'})); assert.equal(await useConsumable(it),false,'ammo has no use flow');
 const old=foundry.applications.api.DialogV2.confirm; foundry.applications.api.DialogV2.confirm=async()=>false;
 ({it,log}=usable('alice')); assert.equal(await useConsumable(it),false); assert.equal(log.consume,0,'declined');
 values.confirmUse=false; assert.equal(await useConsumable(it),true,'confirmation setting off'); values.confirmUse=true;
 foundry.applications.api.DialogV2.confirm=old;purgeUsable();
});
test('tracker use follows PF2e Toolbelt Use Consumable and item macro like its sheet button',async()=>{
 const {useConsumable,getUseRoute}=await import('../scripts/use-consumable.mjs');game.user=alice;
 for (const system of ['pf2e','sf2e']) { game.system.id=system;
  await withToolbelt({use:true},null,async chats=>{
   const {it,log}=usable('alice'); assert.equal(await getUseRoute(it),'toolbelt');
   await useConsumable(it); assert.equal(log.consume,0,'system consume bypassed like Toolbelt'); assert.equal(chats(),1);
   assert.deepEqual(log.update,[{'system.quantity':1,'system.uses.value':1}],'auto-destroy stack decrement');
  });
  await withToolbelt({item:true},null,async()=>{
   const {it,log}=usable('alice'); assert.equal(await getUseRoute(it),'system','macro setting without linked macro');
   await useConsumable(it); assert.equal(log.consume,1);
  });
  let received=null; const macro={execute:async args=>{received=args}};
  await withToolbelt({item:true},macro,async chats=>{
   const {it,log}=usable('alice'); assert.equal(await getUseRoute(it),'macro');
   await useConsumable(it); assert.equal(received.item,it); assert.equal(log.consume,0); assert.equal(log.update.length,0,'macro decides consumption');
   await received.use(); assert.equal(chats(),1); assert.equal(log.update.length,1);
   assert.equal(typeof received.cancel,'function');
  });
  await withToolbelt({item:true,use:true},macro,async()=>{
   const {it,log}=usable('alice',{category:'scroll'}); it.system.category='scroll'; it.system.spell={}; received=null;
   assert.equal(await getUseRoute(it),'system'); await useConsumable(it); assert.equal(log.consume,1,'cast scrolls use the system'); assert.equal(received,null);
  });
  await withToolbelt({use:true},null,async()=>{
   const {it,log}=usable('alice'); it.system.uses={value:1,max:1,autoDestroy:true}; it.system.quantity=1;
   await useConsumable(it); assert.equal(log.deleted,1,'last item deleted');
  });
 }
 game.system.id='pf2e';
 game.modules=new Collection([['pf2e-toolbelt',{active:false}]]);game.toolbelt={getToolSetting:()=>true};
 const {it,log}=usable('alice'); await useConsumable(it); assert.equal(log.consume,1,'inactive Toolbelt ignored');
 game.modules.clear();delete game.toolbelt;purgeUsable();
});
test('tracker rows mark PCs, allies and enemies; GM combat toggles; use button only for owners',async()=>{
 const npc=(id,d)=>{const a={...actor(id,'nobody'),type:'npc',uuid:`Scene.s.Token.${id}.Actor.${id}`,items:new Collection()};
  a.items.set('p',{...item,id:'p',uuid:`${a.uuid}.Item.p`,parent:a,consume:async()=>{}});return {actor:a,token:{name:`${id} token`,disposition:d,hidden:false}}};
 const ally=npc('ally3',1), enemy=npc('enemy3',-1);
 game.combats.active={id:'b',active:true,combatants:[ally,enemy]};
 game.user=gm;const app=new App();app.filters.groupBy='side';
 let ctx=await app._prepareContext({});assert.deepEqual(ctx.groups.map(g=>g.key),['pc']);
 app.filters.showAllies=true;app.filters.showEnemies=true;ctx=await app._prepareContext({});
 assert.deepEqual(ctx.groups.map(g=>g.key),['pc','ally','enemy']);
 const rows=ctx.groups.flatMap(g=>g.items);
 assert.equal(rows.find(r=>r.side==='enemy').actorName,'enemy3 token');assert.equal(rows.find(r=>r.side==='enemy').sideLabel,'pf2e-consumables-tracker.Side.enemy');
 game.user=alice;ctx=await app._prepareContext({});const mine=ctx.groups.flatMap(g=>g.items);
 assert.equal(mine.some(r=>r.side!=='pc'),false,'GM toggles never apply to players');
 assert.equal(mine.find(r=>r.actorId==='source').canUse,false,'others items: request, not use');
 game.combats.active=null;
});
test('delivery use honors Toolbelt instead of opening the sheet',async()=>{
 messages.clear();game.user=alice;
 await withToolbelt({use:true},null,async chats=>{
  const {a,it,log}=usable('alice');game.user=gm;
  const msg=await (async()=>{const m={id:'d',author:gm,flags:{'pf2e-consumables-tracker':{request:{kind:'delivery',itemUuid:it.uuid,targetId:a.id,recipientId:'alice',mode:'use'}}},getFlag(n,k){return this.flags[n][k]}};return m})();
  game.user=alice;await click(action(msg));assert.equal(log.consume,0);assert.equal(chats(),1);assert.equal(log.update.length,1);
 });
 purgeUsable();
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

test('charges, container labels, and unidentified names respect the current user',()=>{
 const a=actor('charge-test','alice');const bag={id:'bag',name:'Backpack'};a.items.set('bag',bag);
 const i={...item,id:'mystery',parent:a,uuid:'Actor.charge-test.Item.mystery',name:'Unidentified potion',img:'unknown.png',isIdentified:false,
   system:{...item.system,quantity:2,containerId:'bag',uses:{value:0,max:3},identification:{identified:{name:'True name',img:'true.png'}}}};
 a.items.set(i.id,i);game.user=alice;
 let row=Data.getActorConsumables(a,{blacklist:[],ignoreContainerItems:false})[0];
 assert.equal(row.name,'Unidentified potion');assert.equal(row.img,'unknown.png');assert.equal(row.unidentified,false);
 assert.deepEqual(row.charges,{value:0,max:3});assert.equal(row.empty,true);assert.equal(row.inContainer,true);assert.equal(row.containerName,'Backpack');
 assert.equal(Data.getActorConsumables(a,{blacklist:[],ignoreContainerItems:true}).length,0);
 game.user=gm;row=Data.getActorConsumables(a,{blacklist:[],ignoreContainerItems:false})[0];
 assert.equal(row.name,'True name');assert.equal(row.img,'true.png');assert.equal(row.unidentified,true);
 i.system.uses={value:1,max:1};assert.equal(Data.getActorConsumables(a,{blacklist:[],ignoreContainerItems:false})[0].charges,null);
});

test('GM opens unidentified synthetic-token item from live actor without UUID resolver',async()=>{
 game.user=gm;let opened=0;
 const npc={...actor('isolated','none'),type:'npc',uuid:'Scene.s.Token.t.Actor.synthetic',items:new Collection()};
 const i={...item,id:'mystery',uuid:`${npc.uuid}.Item.mystery`,parent:npc,name:'Unknown',isIdentified:false,
  sheet:{render:async()=>{opened++}},system:{...item.system,identification:{identified:{name:'GM true name'}}}};npc.items.set(i.id,i);
 game.combats.active={id:'b',active:true,combatants:[{actor:npc,token:{name:'Secret',disposition:-1}}]};
 const app=new App();app.filters.showEnemies=true;const ctx=await app._prepareContext({});
 assert.equal(ctx.groups.flatMap(g=>g.items).find(x=>x.uuid===i.uuid).name,'GM true name');
 assert.equal(await fromUuid(i.uuid),null,'simulates resolver failing for synthetic actor');
 await App.DEFAULT_OPTIONS.actions.openItem.call(app,{preventDefault(){}},{dataset:{uuid:i.uuid}});assert.equal(opened,1);
 npc.items.delete(i.id);await App.DEFAULT_OPTIONS.actions.openItem.call(app,{preventDefault(){}},{dataset:{uuid:i.uuid}});assert.equal(opened,1);
 game.combats.active=null;
});

test('quick filters by category, side and character are independent of grouping',async()=>{
 game.user=gm;const a=actor('filter-test','alice');a.name='Quick character';actors.set(a.id,a);
 a.items.set('special',{...item,id:'special',uuid:`${a.uuid}.Item.special`,parent:a,name:'Quick elixir',system:{...item.system,category:'elixir'}});
 const app=new App();app.filters.groupBy='side';app.filters.category='elixir';app.filters.character='Quick character';app.filters.side='pc';
 const ctx=await app._prepareContext({});assert.equal(ctx.totalCount,1);assert.equal(ctx.groups[0].items[0].name,'Quick elixir');
 assert.ok(ctx.categoryChoices.some(x=>x.value==='elixir'&&x.selected));actors.delete(a.id);
});

test('switches and collapsed groups survive close and queued setting writes',async()=>{
 game.user=gm;values.lastFilters={};const app=new App();
 const controls=[{type:'checkbox',dataset:{filter:'showAllies'},checked:true},{type:'checkbox',dataset:{filter:'showEnemies'},checked:true},{type:'checkbox',dataset:{filter:'compact'},checked:true}];
 const group={open:false,dataset:{groupType:'category',groupKey:'potion'},addEventListener(_event,fn){this.handler=fn}};
 controls.forEach(c=>c.addEventListener=function(_event,fn){this.handler=fn});
 app.element={querySelectorAll(selector){return selector==='details[data-group-key]'?[group]:selector==='input[data-filter]'?controls:[]},querySelector(){return null}};
 app._onRender({},{});for(const c of controls)c.handler({target:c});group.handler();
 const immediately=new App();assert.equal(immediately.filters.showAllies,true);assert.equal(immediately.filters.showEnemies,true);assert.equal(immediately.filters.compact,true);
 assert.ok(immediately.collapsedGroups.has(JSON.stringify(['category','potion'])));
 await app.persistQueue;assert.equal(values.lastFilters.showEnemies,true);assert.equal(values.lastFilters.showAllies,true);assert.equal(values.lastFilters.compact,true);
});

test('owner can decline once and all participants see a rejected request',async()=>{
 messages.clear();item.system.quantity=2;game.user=alice;dialogResult='use';await createRequest(item.uuid,target.id);const req=messages.get('1');
 assert.match(statusText(req),/StatusPending/);game.user=bob;assert.ok(action(req,0));assert.ok(action(req,1));await click(action(req,1));
 assert.equal(messages.size,2);assert.equal(messages.get('2').flags['pf2e-consumables-tracker'].request.kind,'decline');
 assert.match(statusText(req),/StatusDeclined/);assert.equal(action(req),undefined);game.user=gm;assert.equal(action(messages.get('2')),undefined);
 assert.equal(item.system.quantity,2);game.user=alice;assert.match(statusText(req),/StatusDeclined/);
});

test('approval and transfer statuses follow the workflow',async()=>{
 messages.clear();item.system.quantity=2;game.user=alice;dialogResult='take';await createRequest(item.uuid,target.id);const req=messages.get('1');
 game.user=bob;await click(action(req));assert.match(statusText(req),/StatusApproved/);assert.equal(action(req),undefined);
 const approval=messages.get('2');game.user=gm;assert.match(statusText(approval),/StatusApproved/);await click(action(approval));
 assert.match(statusText(req),/StatusDone/);assert.match(statusText(approval),/StatusDone/);assert.equal(action(approval),undefined);
});

test('settings writes remain ordered across consecutive window instances',async()=>{
 game.user=gm;const oldSet=game.settings.set;let release;let writes=0;
 game.settings.set=async(_m,key,value)=>{if(++writes===1) await new Promise(r=>release=r);values[key]=value};
 function toggle(app,checked){const input={type:'checkbox',dataset:{filter:'showEnemies'},checked,addEventListener(_n,fn){this.handler=fn}};
  app.element={querySelector:()=>null,querySelectorAll:s=>s==='input[data-filter]'?[input]:[]};app._onRender({},{});input.handler({target:input});}
 try {
  const first=new App();toggle(first,true);await new Promise(r=>setTimeout(r,0));assert.equal(writes,1);
  const second=new App();toggle(second,false);await new Promise(r=>setTimeout(r,0));assert.equal(writes,1,'second write waits');
  release();await second.persistQueue;assert.equal(writes,2);assert.equal(values.lastFilters.showEnemies,false);
 } finally {game.settings.set=oldSet}
});

test('forged denial does not prevent a legitimate approval',async()=>{
 messages.clear();item.system.quantity=2;game.user=alice;dialogResult='take';await createRequest(item.uuid,target.id);const req=messages.get('1');
 const d=req.getFlag('pf2e-consumables-tracker','request');const snapshot=JSON.stringify([d.sourceId,d.targetId,d.itemId,d.quantity,d.mode,alice.id]);
 await ChatMessage.create({content:'fake',flags:{'pf2e-consumables-tracker':{request:{kind:'decline',requestId:req.id,snapshot}}}});
 game.user=bob;assert.match(statusText(req),/StatusPending/);await click(action(req));assert.match(statusText(req),/StatusApproved/);
});

test('system use posts the item card; enemy and unidentified uses are GM-only',async()=>{
 const {useConsumable,registerUseHooks}=await import('../scripts/use-consumable.mjs');registerUseHooks();
 const oldCreate=ChatMessage.create;const created=[];
 const pre=hooks.preCreateChatMessage.at(-1);
 ChatMessage.create=async data=>{const m={...data,updateSource(u){Object.assign(this,u)}};pre(m);created.push(m);return m};
 ChatMessage.getSpeaker=({actor})=>({actor:actor?.id});
 values.confirmUse=false;
 try{
  game.user=alice;let {it,log}=usable('alice');await useConsumable(it);
  assert.equal(log.consume,1);assert.equal(created.length,1);assert.match(created[0].content,/card/);assert.equal(created[0].whisper,undefined,'public card for own identified item');
  created.length=0;({it,log}=usable('alice',{isIdentified:false,consume:async function(){await ChatMessage.create({speaker:{actor:this.parent.id},content:'uses'});log.consume++}}));
  await useConsumable(it);assert.equal(created.length,2);for(const m of created) assert.deepEqual(m.whisper,['gm'],'unidentified card and system notice whispered');
  created.length=0;game.user=gm;({it,log}=usable('nobody'));const npc=it.parent;npc.type='npc';npc.hasPlayerOwner=false;npc.prototypeToken={disposition:-1};
  await useConsumable(it);assert.equal(log.consume,1);assert.deepEqual(created[0].whisper,['gm'],'enemy card is GM-only');
  created.length=0;npc.prototypeToken={disposition:1};it.system.uses.value=1;await useConsumable(it);assert.equal(created[0].whisper,undefined,'allied card is public');
  created.length=0;await ChatMessage.create({speaker:{actor:npc.id},content:'later'});assert.equal(created[0].whisper,undefined,'context ends after use');
  values.postUseCard=false;created.length=0;await useConsumable(it);assert.equal(created.length,0,'card can be disabled');delete values.postUseCard;
 } finally {ChatMessage.create=oldCreate;delete ChatMessage.getSpeaker;values.confirmUse=true;purgeUsable();game.user=alice;}
});

test('GM reveals chosen NPC consumables; players get only display data',async()=>{
 const {buildSharedCombatAllies,querySharedCombatAllies}=await import('../scripts/combat-consumables.mjs');
 const flags={};
 const e={...actor('enemyR','nobody'),type:'npc',hasPlayerOwner:false,uuid:'Actor.enemyR',items:new Collection(),testUserPermission:()=>false};
 const secret={...item,id:'secret',uuid:'Actor.enemyR.Item.secret',name:'Unknown Vial',isIdentified:false,parent:e,system:{...item.system,identification:{identified:{name:'Bomb'}}},
  getFlag:(_m,k)=>flags[k],setFlag:async(_m,k,v)=>{flags[k]=v},unsetFlag:async(_m,k)=>{delete flags[k]}};
 const plain={...item,id:'plain',uuid:'Actor.enemyR.Item.plain',name:'Enemy potion',isIdentified:true,parent:e};
 e.items.set(secret.id,secret);e.items.set(plain.id,plain);
 const token={name:'Goblin',disposition:-1,hidden:false,actor:e};
 game.combats.active={id:'battle',active:true,combatants:[{actor:e,token}]};values.shareCombatAllies=false;
 game.user=gm;assert.deepEqual(buildSharedCombatAllies({combatId:'battle'}),[]);
 const app=new App();app.filters.showEnemies=true;let ctx=await app._prepareContext({});
 const row=ctx.groups.flatMap(g=>g.items).find(i=>i.id==='secret');assert.equal(row.canReveal,true);assert.equal(row.revealed,false);assert.equal(row.name,'Bomb');
 const button={dataset:{uuid:secret.uuid},disabled:false,isConnected:true};
 await App.DEFAULT_OPTIONS.actions.toggleReveal.call(app,{preventDefault(){},stopPropagation(){}},button);assert.equal(flags.revealed,true);
 let shared=buildSharedCombatAllies({combatId:'battle'});assert.equal(shared.length,1);
 assert.equal(shared[0].name,'Unknown Vial','mystified name for players');assert.equal(shared[0].side,'enemy');assert.equal('uuid' in shared[0],false);assert.equal(shared[0].canUse,false);
 token.hidden=true;assert.equal(buildSharedCombatAllies({combatId:'battle'}).length,0,'hidden combatants never shared');token.hidden=false;
 gm.query=async (_q,data)=>{const old=game.user;game.user=gm;const answer=buildSharedCombatAllies(data);game.user=old;return answer};
 game.user=alice;const papp=new App();ctx=await papp._prepareContext({});const seen=ctx.groups.flatMap(g=>g.items).find(i=>i.name==='Unknown Vial');
 assert.ok(seen);assert.equal(seen.revealed,true);assert.equal(seen.side,'enemy');assert.equal(seen.canOpen,false);assert.equal(seen.canReveal,false);assert.equal(ctx.shareError,false);
 assert.equal(ctx.groups.flatMap(g=>g.items).some(i=>i.name==='Enemy potion'),false,'unrevealed items stay hidden');
 await App.DEFAULT_OPTIONS.actions.toggleReveal.call(papp,{preventDefault(){},stopPropagation(){}},button);assert.equal(flags.revealed,true,'players cannot toggle');
 game.user=gm;await App.DEFAULT_OPTIONS.actions.toggleReveal.call(app,{preventDefault(){},stopPropagation(){}},button);assert.equal(flags.revealed,undefined);
 assert.equal(buildSharedCombatAllies({combatId:'battle'}).length,0);
 game.user=alice;assert.deepEqual((await querySharedCombatAllies()).items,[]);
 delete gm.query;game.combats.active=null;
});
