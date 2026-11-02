import { MODULE_ID } from "../constants.mjs";
import { getTrackedActors, getActorConsumables } from "../data/consumables-data.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * apps/blacklist-config-app.mjs
 *
 * GM-only settings form for managing the list of consumables that should be hidden from the
 * tracker entirely. Registered as a `game.settings.registerMenu` target in the main entry
 * point, so it's also reachable from the standard Module Settings screen, not just the
 * tracker panel's "Configure Blacklist" button.
 *
 * Entries are matched (case-insensitively) against an item's id, slug, or name - see
 * `isBlacklisted()` in data/consumables-data.mjs. We deliberately use a plain one-entry-
 * per-line textarea rather than a dynamic add/remove row UI: it's trivial to bulk-edit,
 * easy to copy/paste from the reference list below it, and has no fragile per-row state to
 * keep in sync across re-renders.
 */
export class BlacklistConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pf2e-consumables-tracker-blacklist-config",
    tag: "form",
    classes: ["pf2e-consumables-tracker", "blacklist-config"],
    window: {
      title: `${MODULE_ID}.Settings.BlacklistMenu.Label`,
      icon: "fa-solid fa-ban"
    },
    position: {
      width: 520,
      height: "auto"
    },
    actions: {
      cancel: BlacklistConfigApp.#onCancel,
      addKnownName: BlacklistConfigApp.#onAddKnownName
    },
    form: {
      handler: BlacklistConfigApp.#onSubmit,
      submitOnChange: false,
      closeOnSubmit: true
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/blacklist-config.hbs` }
  };

  /** @override */
  async _prepareContext(_options) {
    const blacklist = game.settings.get(MODULE_ID, "blacklist");

    // Build a reference list of every consumable name currently tracked across the whole
    // party (ignoring the container/blacklist filters, so the GM can see - and blacklist -
    // items that are currently being filtered out for other reasons too) so they can copy
    // exact names into the textarea below instead of retyping them by hand.
    const actors = getTrackedActors("party");
    const knownNames = new Set();
    for (const actor of actors) {
      const items = getActorConsumables(actor, { ignoreContainerItems: false, blacklist: [] });
      for (const item of items) knownNames.add(item.name);
    }

    return {
      blacklistText: blacklist.join("\n"),
      knownNames: Array.from(knownNames).sort((a, b) => a.localeCompare(b))
    };
  }

  static #onCancel(event, _target) {
    event.preventDefault();
    this.close();
  }

  /**
   * Clicking a name in the "currently tracked" reference list appends it to the textarea
   * above as a new line (skipping it if already present), instead of requiring the user to
   * manually select and copy text out of the list - which is unreliable inside an
   * ApplicationV2 window and was the actual source of the "can't copy text" report this
   * replaces.
   */
  static #onAddKnownName(event, target) {
    event.preventDefault();
    const name = target.dataset.name;
    if (!name) return;

    const textarea = this.element.querySelector('textarea[name="blacklist"]');
    if (!textarea) return;

    const lines = textarea.value
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (!lines.includes(name)) {
      lines.push(name);
      textarea.value = lines.join("\n");
    }

    // Give the user immediate feedback that the click did something, since there's no
    // native focus change or visible cursor to signal it otherwise.
    textarea.focus();
    textarea.scrollTop = textarea.scrollHeight;
  }

  /**
   * Form submit handler. `formData.object.blacklist` is the raw textarea contents; we split
   * it into one trimmed, de-duplicated entry per non-empty line and persist that array to
   * the world-scoped "blacklist" setting.
   */
  static async #onSubmit(_event, _form, formData) {
    const raw = formData.object.blacklist ?? "";
    const entries = raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const unique = Array.from(new Set(entries));
    await game.settings.set(MODULE_ID, "blacklist", unique);
  }
}
