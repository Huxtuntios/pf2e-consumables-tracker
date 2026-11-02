import { MODULE_ID, GROUP_BY_OPTIONS, SORT_BY_OPTIONS, VIEW_MODE_OPTIONS, SIDES } from "../constants.mjs";
import {
  getTrackedActors,
  getActorConsumables,
  groupConsumables,
  sortConsumables,
  getCategoryLabel,
  getTraitLabel,
  getSideLabel,
  sideFields
} from "../data/consumables-data.mjs";
import { getCombatNPCs, querySharedCombatAllies } from "../combat-consumables.mjs";
import { createRequest } from "../requests.mjs";
import { useConsumable, getUseRoute } from "../use-consumable.mjs";
import { BlacklistConfigApp } from "./blacklist-config-app.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * apps/consumables-tracker-app.mjs
 *
 * The main toggleable panel showing the party's tracked consumables. Implemented as a
 * singleton ApplicationV2 (there is only ever one tracker window open at a time; opening it
 * again just re-focuses the existing instance) so other parts of the module can cheaply ask
 * "is the tracker open, and if so, please refresh it" whenever relevant data changes
 * (an item is used up, a character is added to the party, a setting changes, etc).
 */
export class ConsumablesTrackerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** The single shared instance, created lazily the first time the tracker is opened. */
  static #instance = null;

  static DEFAULT_OPTIONS = {
    id: "pf2e-consumables-tracker-app",
    tag: "div",
    classes: ["pf2e-consumables-tracker"],
    window: {
      title: `${MODULE_ID}.AppTitle`,
      icon: "fa-solid fa-flask-round-potion",
      resizable: true
    },
    position: {
      width: 640,
      height: 720
    },
    actions: {
      openItem: ConsumablesTrackerApp.#onOpenItem,
      openBlacklist: ConsumablesTrackerApp.#onOpenBlacklist,
      toggleSortDir: ConsumablesTrackerApp.#onToggleSortDir,
      refresh: ConsumablesTrackerApp.#onRefresh,
      requestItem: ConsumablesTrackerApp.#onRequestItem,
      useItem: ConsumablesTrackerApp.#onUseItem
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/consumables-tracker.hbs` }
  };

  constructor(options = {}) {
    super(options);
    // View mode, group-by, and sort preferences are remembered per-player (client-scoped
    // setting) so the panel opens the way each person last left it, instead of resetting to
    // the same defaults every session. actorId/userId and the search box are deliberately
    // NOT persisted: a remembered actor/player id could point at something since renamed or
    // deleted (though _prepareContext already falls back gracefully if so), and a leftover
    // search term is more likely to cause "why is this empty" confusion than help.
    const persisted = game.settings.get(MODULE_ID, "lastFilters") ?? {};
    this.allyCache = null;
    this.allyRevision = 0;
    this.allyRefreshTimer = null;
    this.filters = {
      viewMode: persisted.viewMode ?? "party",
      actorId: null,
      userId: null,
      groupBy: persisted.groupBy ?? "category",
      sortBy: persisted.sortBy ?? "level",
      sortDir: persisted.sortDir ?? "asc",
      search: "",
      recipientId: game.user.character?.id ?? null,
      showEnemies: false,
      showAllies: false
    };
  }

  /** Persist the current view/group/sort preferences for next time. */
  #persistFilters() {
    game.settings.set(MODULE_ID, "lastFilters", {
      viewMode: this.filters.viewMode,
      groupBy: this.filters.groupBy,
      sortBy: this.filters.sortBy,
      sortDir: this.filters.sortDir
    });
  }

  /* -------------------------------------------- */
  /*  Singleton lifecycle                          */
  /* -------------------------------------------- */

  /** Open (creating if necessary) the single shared tracker instance. */
  static open() {
    if (!ConsumablesTrackerApp.#instance) {
      ConsumablesTrackerApp.#instance = new ConsumablesTrackerApp();
    }
    ConsumablesTrackerApp.#instance.render(true);
    return ConsumablesTrackerApp.#instance;
  }

  /** Re-render the tracker only if it's already open - used by change-listening hooks so we
   * don't needlessly construct/render the app when nobody has it open. */
  static refreshOpenInstance() {
    if (ConsumablesTrackerApp.#instance?.rendered) {
      ConsumablesTrackerApp.#instance.allyCache = null;
      ConsumablesTrackerApp.#instance.allyRevision++;
      ConsumablesTrackerApp.#instance.render();
    }
  }

  /** Whether the tracker is currently open. Used by the scene control toggle button. */
  static get isOpen() {
    return Boolean(ConsumablesTrackerApp.#instance?.rendered);
  }

  /** Close the tracker if it's currently open. No-op otherwise. */
  static closeOpenInstance() {
    if (ConsumablesTrackerApp.#instance?.rendered) {
      ConsumablesTrackerApp.#instance.close();
    }
  }

  /** @override */
  _onClose(options) {
    clearInterval(this.allyRefreshTimer);
    this.allyRefreshTimer = null;
    super._onClose(options);
    // Allow a fresh instance (with reset filters) next time the tracker is opened.
    if (ConsumablesTrackerApp.#instance === this) ConsumablesTrackerApp.#instance = null;
  }

  /* -------------------------------------------- */
  /*  Rendering                                    */
  /* -------------------------------------------- */

  /**
   * Re-render while preserving keyboard focus and cursor position on whichever filter
   * control the user was interacting with. Without this, every keystroke in the search box
   * would rebuild the DOM and kick focus out of the input.
   * @override
   */
  async render(options) {
    const active = this.element?.querySelector(":focus");
    const focusedFilter = active?.dataset?.filter;
    const selectionStart = active?.tagName === "INPUT" && active.type === "text" ? active.selectionStart : null;
    const selectionEnd = active?.tagName === "INPUT" && active.type === "text" ? active.selectionEnd : null;

    const result = await super.render(options);

    if (focusedFilter) {
      const el = this.element?.querySelector(`[data-filter="${focusedFilter}"]`);
      if (el) {
        el.focus();
        if (typeof selectionStart === "number" && typeof el.setSelectionRange === "function") {
          try {
            el.setSelectionRange(selectionStart, selectionEnd);
          } catch {
            // setSelectionRange throws on some input types (e.g. <select>) - harmless.
          }
        }
      }
    }

    return result;
  }

  /** @override */
  async _prepareContext(_options) {
    const isGM = game.user.isGM;
    const restrictPlayerView = game.settings.get(MODULE_ID, "restrictPlayerView");
    const ignoreContainerItems = game.settings.get(MODULE_ID, "ignoreContainerItems");
    const blacklist = game.settings.get(MODULE_ID, "blacklist");

    // Non-GM players, when the GM has enabled the restriction setting, can only browse the
    // whole party or their own character(s) - not pick an arbitrary other player's sheet.
    const availableViewModes =
      !isGM && restrictPlayerView ? VIEW_MODE_OPTIONS.filter((m) => m !== "player") : VIEW_MODE_OPTIONS;
    if (!availableViewModes.includes(this.filters.viewMode)) this.filters.viewMode = "party";

    const allCharacters = game.actors.filter((a) => a.type === "character" && a.hasPlayerOwner && (isGM || a.testUserPermission(game.user, "OBSERVER")));
    const recipients = allCharacters.filter(a => a.isOwner);
    if (!recipients.some(a => a.id === this.filters.recipientId)) this.filters.recipientId = recipients[0]?.id ?? null;
    const characterChoicePool = !isGM && restrictPlayerView ? allCharacters.filter((a) => a.isOwner) : allCharacters;

    if (this.filters.viewMode === "character") {
      const stillValid = characterChoicePool.some((a) => a.id === this.filters.actorId);
      if (!stillValid) this.filters.actorId = characterChoicePool[0]?.id ?? null;
    }

    const playerChoicePool = game.users.filter((u) => !u.isGM);
    if (this.filters.viewMode === "player") {
      const stillValid = playerChoicePool.some((u) => u.id === this.filters.userId);
      if (!stillValid) this.filters.userId = playerChoicePool[0]?.id ?? null;
    }

    const trackedActors = getTrackedActors(this.filters.viewMode, {
      actorId: this.filters.actorId,
      userId: this.filters.userId
    });

    const visibleActors = trackedActors.filter(a => isGM || a.testUserPermission(game.user, "OBSERVER"));
    const sources = visibleActors.map(actor => ({actor, side: "pc"}));
    if (isGM) {
      // GM-only combat views, each NPC marked by its token disposition.
      const seen = new Set(visibleActors.map(a => a.uuid));
      const D = CONST.TOKEN_DISPOSITIONS;
      const combatViews = [[this.filters.showAllies, D.FRIENDLY, "ally"], [this.filters.showEnemies, D.HOSTILE, "enemy"]];
      for (const [enabled, disposition, side] of combatViews) {
        if (!enabled) continue;
        for (const {actor, token} of getCombatNPCs(game.combats?.active, disposition)) {
          if (seen.has(actor.uuid)) continue;
          seen.add(actor.uuid);
          sources.push({actor, side, displayName: token?.name});
        }
      }
    }
    let items = sources.flatMap(({actor, side, displayName}) => getActorConsumables(actor, { ignoreContainerItems, blacklist, side, displayName }));
    let shareError = false;
    if (!isGM && game.settings.get(MODULE_ID, "shareCombatAllies")) {
      const combatId = game.combats?.active?.active ? game.combats.active.id : null;
      const gmId = game.users.activeGM?.id ?? null;
      if (!this.allyCache || this.allyCache.combatId !== combatId || this.allyCache.gmId !== gmId || Date.now() - this.allyCache.time > 8000) {
        const revision = this.allyRevision;
        const result = await querySharedCombatAllies();
        if (revision === this.allyRevision) this.allyCache = {combatId, gmId, time:Date.now(), ...result};
      }
      if (this.allyCache && game.settings.get(MODULE_ID, "shareCombatAllies") && game.combats?.active?.active &&
          this.allyCache.combatId === game.combats.active.id && this.allyCache.gmId === (game.users.activeGM?.id ?? null)) {
        // Re-localize markers on this client; the GM may use another language.
        items.push(...this.allyCache.items.map(item => ({...item, ...sideFields("ally"), canUse: false})));
        shareError = this.allyCache.error;
      }
    }

    const searchTerm = (this.filters.search ?? "").trim().toLowerCase();
    if (searchTerm) {
      items = items.filter((item) => item.name.toLowerCase().includes(searchTerm));
    }

    const sorted = sortConsumables(items, this.filters.sortBy, this.filters.sortDir);
    const groupedRaw = groupConsumables(sorted, this.filters.groupBy);

    const routeLabels = {
      system: game.i18n.localize(`${MODULE_ID}.UseRoute.system`),
      toolbelt: game.i18n.localize(`${MODULE_ID}.UseRoute.toolbelt`),
      macro: game.i18n.localize(`${MODULE_ID}.UseRoute.macro`)
    };
    await Promise.all(sorted.filter(item => item.canUse).map(async item => {
      try { item.useTitle = routeLabels[await getUseRoute(await fromUuid(item.uuid))] ?? routeLabels.system; }
      catch { item.useTitle = routeLabels.system; }
    }));

    const groups = Object.entries(groupedRaw)
      .map(([key, groupItems]) => ({
        key,
        label: this.#getGroupLabel(this.filters.groupBy, key),
        items: groupItems,
        count: groupItems.length
      }))
      .sort((a, b) => this.filters.groupBy === "side"
        ? SIDES.indexOf(a.key) - SIDES.indexOf(b.key)
        : a.label.localeCompare(b.label));

    return {
      isGM,
      shareError,
      showRecipientSelect: !isGM && recipients.length > 0,
      recipientChoices: recipients.map(a => ({ id: a.id, name: a.name, selected: a.id === this.filters.recipientId })),
      filters: this.filters,
      viewModes: availableViewModes.map((mode) => ({
        value: mode,
        label: game.i18n.localize(`${MODULE_ID}.ViewMode.${mode}`),
        selected: mode === this.filters.viewMode
      })),
      showPlayerSelect: this.filters.viewMode === "player",
      showCharacterSelect: this.filters.viewMode === "character",
      characterChoices: characterChoicePool.map((a) => ({
        id: a.id,
        name: a.name,
        selected: a.id === this.filters.actorId
      })),
      playerChoices: playerChoicePool.map((u) => ({
        id: u.id,
        name: u.name,
        selected: u.id === this.filters.userId
      })),
      groupByChoices: GROUP_BY_OPTIONS.map((g) => ({
        value: g,
        label: game.i18n.localize(`${MODULE_ID}.GroupBy.${g}`),
        selected: g === this.filters.groupBy
      })),
      sortByChoices: SORT_BY_OPTIONS.map((s) => ({
        value: s,
        label: game.i18n.localize(`${MODULE_ID}.SortBy.${s}`),
        selected: s === this.filters.sortBy
      })),
      sortDir: this.filters.sortDir,
      search: this.filters.search,
      showGroupHeaders: this.filters.groupBy !== "none",
      groups,
      totalCount: items.length,
      totalText: game.i18n.format(`${MODULE_ID}.TotalCount`, { count: items.length }),
      hasResults: items.length > 0
    };
  }

  #getGroupLabel(groupBy, key) {
    switch (groupBy) {
      case "category":
        return getCategoryLabel(key);
      case "trait":
        return getTraitLabel(key);
      case "character":
        return key;
      case "side":
        return getSideLabel(key);
      default:
        return "";
    }
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    if (!game.user.isGM && !this.allyRefreshTimer) {
      this.allyRefreshTimer = setInterval(() => {
        if (this.rendered && game.settings.get(MODULE_ID, "shareCombatAllies")) {
          this.allyCache = null;
          this.allyRevision++;
          this.render();
        }
      }, 10000);
    }

    for (const el of root.querySelectorAll("select[data-filter]")) {
      el.addEventListener("change", this.#onFilterChange.bind(this));
    }
    for (const el of root.querySelectorAll("input[data-filter]")) {
      el.addEventListener(el.type === "checkbox" ? "change" : "input", this.#onFilterChange.bind(this));
    }
  }

  #onFilterChange(event) {
    const { filter } = event.target.dataset;
    if (!filter) return;
    this.filters[filter] = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    this.#persistFilters();
    this.render();
  }

  /* -------------------------------------------- */
  /*  Actions                                      */
  /* -------------------------------------------- */

  /** Open the clicked item's sheet. Bound via `data-action="openItem"` in the template. */
  static async #onOpenItem(event, target) {
    event.preventDefault();
    const uuid = target.dataset.uuid;
    if (!uuid) return;
    const item = await fromUuid(uuid);
    item?.sheet?.render(true);
  }

  static async #onRequestItem(event, target) {
    event.preventDefault();
    event.stopPropagation();
    try { await createRequest(target.dataset.uuid, this.filters.recipientId); }
    catch (error) { console.error(`${MODULE_ID} | Request failed`, error); ui.notifications.error(game.i18n.localize(`${MODULE_ID}.RequestError`)); }
  }

  /** Use one consumable from the tracker, honoring PF2e Toolbelt settings and item macros. */
  static async #onUseItem(event, target) {
    event.preventDefault();
    event.stopPropagation();
    if (target.disabled) return;
    target.disabled = true;
    try {
      const item = await fromUuid(target.dataset.uuid ?? "");
      await useConsumable(item, {event});
    } catch (error) {
      console.error(`${MODULE_ID} | Use failed`, error);
      ui.notifications.error(game.i18n.localize(`${MODULE_ID}.UseError`));
    } finally {
      if (target.isConnected) target.disabled = false;
    }
  }

  /** GM-only: open the blacklist configuration form. */
  static #onOpenBlacklist(event, _target) {
    event.preventDefault();
    if (!game.user.isGM) return;
    new BlacklistConfigApp().render(true);
  }

  /** Flip ascending/descending sort direction. */
  static #onToggleSortDir(event, _target) {
    event.preventDefault();
    this.filters.sortDir = this.filters.sortDir === "asc" ? "desc" : "asc";
    this.#persistFilters();
    this.render();
  }

  /** Manual refresh button, for the rare case a change wasn't caught by the document hooks. */
  static #onRefresh(event, _target) {
    event.preventDefault();
    this.allyCache = null;
    this.allyRevision++;
    this.render();
  }
}
