import { MODULE_ID } from "./constants.mjs";
import { ConsumablesTrackerApp } from "./apps/consumables-tracker-app.mjs";
import { BlacklistConfigApp } from "./apps/blacklist-config-app.mjs";
import { registerRequestHooks } from "./requests.mjs";
import { registerCombatQuery } from "./combat-consumables.mjs";
import { useConsumable } from "./use-consumable.mjs";

Hooks.once("init", () => {
  registerRequestHooks();
  registerCombatQuery();
  Handlebars.registerHelper("pctEq", (a, b) => a === b);
  // Register settings during init.

  game.settings.register(MODULE_ID, "ignoreContainerItems", {
    name: `${MODULE_ID}.Settings.IgnoreContainerItems.Name`,
    hint: `${MODULE_ID}.Settings.IgnoreContainerItems.Hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => ConsumablesTrackerApp.refreshOpenInstance()
  });

  game.settings.register(MODULE_ID, "restrictPlayerView", {
    name: `${MODULE_ID}.Settings.RestrictPlayerView.Name`,
    hint: `${MODULE_ID}.Settings.RestrictPlayerView.Hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => ConsumablesTrackerApp.refreshOpenInstance()
  });

  game.settings.register(MODULE_ID, "shareCombatAllies", {
    name: `${MODULE_ID}.Settings.ShareCombatAllies.Name`,
    hint: `${MODULE_ID}.Settings.ShareCombatAllies.Hint`,
    scope: "world", config: true, type: Boolean, default: false,
    onChange: () => ConsumablesTrackerApp.refreshOpenInstance()
  });

  game.settings.register(MODULE_ID, "confirmUse", {
    name: `${MODULE_ID}.Settings.ConfirmUse.Name`,
    hint: `${MODULE_ID}.Settings.ConfirmUse.Hint`,
    scope: "client", config: true, type: Boolean, default: true
  });

  // The blacklist itself is not shown directly in the Module Settings list (config: false) -
  // it's managed through the dedicated BlacklistConfigApp menu registered below, which gives
  // the GM a proper textarea instead of a single-line settings field.
  game.settings.register(MODULE_ID, "blacklist", {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: () => ConsumablesTrackerApp.refreshOpenInstance()
  });

  // Per-player memory of their last-used view/group/sort choices (not shown in the settings
  // list - it's written automatically by the tracker app itself, not edited by hand).
  game.settings.register(MODULE_ID, "lastFilters", {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.registerMenu(MODULE_ID, "blacklistMenu", {
    name: `${MODULE_ID}.Settings.BlacklistMenu.Name`,
    label: `${MODULE_ID}.Settings.BlacklistMenu.Label`,
    hint: `${MODULE_ID}.Settings.BlacklistMenu.Hint`,
    icon: "fa-solid fa-ban",
    type: BlacklistConfigApp,
    restricted: true // GM only
  });

  // Unbound by default; each user can assign a key in Configure Controls.
  game.keybindings.register(MODULE_ID, "openTracker", {
    name: `${MODULE_ID}.Keybinding.OpenTracker.Name`,
    hint: `${MODULE_ID}.Keybinding.OpenTracker.Hint`,
    editable: [],
    onDown: () => {
      ConsumablesTrackerApp.open();
      return true;
    }
  });


  // Preload templates so the first time a user opens the tracker there's no render delay.
  const preloadTemplates = foundry.applications.handlebars.loadTemplates;
  preloadTemplates([
    `modules/${MODULE_ID}/templates/consumables-tracker.hbs`,
    `modules/${MODULE_ID}/templates/blacklist-config.hbs`
  ]);
});

/* -------------------------------------------- */
/*  ready                                        */
/* -------------------------------------------- */

Hooks.once("ready", () => {
  // Expose a small API for macros / other modules: game.modules.get(MODULE_ID).api
  const moduleData = game.modules.get(MODULE_ID);
  if (moduleData) {
    moduleData.api = {
      ConsumablesTrackerApp,
      BlacklistConfigApp,
      open: () => ConsumablesTrackerApp.open(),
      useConsumable
    };
  }
});

Hooks.on("getSceneControlButtons", (controls) => {
  const tool = {
    name: "toggleTracker",
    title: `${MODULE_ID}.SidebarButton`,
    icon: "fa-solid fa-flask-round-potion",
    button: true,
    visible: true,
    onChange: () => {
      if (ConsumablesTrackerApp.isOpen) {
        ConsumablesTrackerApp.closeOpenInstance();
      } else {
        ConsumablesTrackerApp.open();
      }
    }
  };

  if (controls.tokens) {
    if (!controls.tokens.tools) return;
    tool.order = Object.keys(controls.tokens.tools).length;
    controls.tokens.tools[tool.name] = tool;
  }
});

/* -------------------------------------------- */
/*  Live-refresh hooks                           */
/* -------------------------------------------- */

/**
 * Keep an open tracker panel in sync as the world changes: items being used up, characters
 * being added to/removed from the party, etc. Each handler is intentionally narrow (checking
 * document type/parent) rather than one broad catch-all, so we don't trigger a re-render for
 * unrelated document churn elsewhere in the world.
 */

function refreshIfCharacterItem(item) {
  if (item.parent?.documentName === "Actor" && ["character", "npc"].includes(item.parent.type)) {
    ConsumablesTrackerApp.refreshOpenInstance();
  }
}

Hooks.on("createItem", refreshIfCharacterItem);
Hooks.on("updateItem", refreshIfCharacterItem);
Hooks.on("deleteItem", refreshIfCharacterItem);

function refreshIfCharacterActor(actor) {
  if (["character", "npc", "party"].includes(actor.type)) ConsumablesTrackerApp.refreshOpenInstance();
}

Hooks.on("createActor", refreshIfCharacterActor);
Hooks.on("updateActor", refreshIfCharacterActor);
Hooks.on("deleteActor", refreshIfCharacterActor);

for (const hook of ["createToken", "updateToken", "deleteToken", "canvasReady", "createCombat", "updateCombat", "deleteCombat", "createCombatant", "updateCombatant", "deleteCombatant"]) {
  Hooks.on(hook, () => ConsumablesTrackerApp.refreshOpenInstance());
}
