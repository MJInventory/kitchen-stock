(function setupScreenAccess(globalObject) {
  const LOGOUT_VALUE = "__logout__";

  function configuredSections(config = {}) {
    return [
      { name: "goto", items: config.gotoItems || [] },
      { name: "backoffice", items: config.backofficeItems || [] }
    ];
  }

  function itemPaths(item = {}) {
    return [item.href, ...(Array.isArray(item.paths) ? item.paths : [])].filter(Boolean);
  }

  function findItemForPath(pathname, config = {}) {
    for (const section of configuredSections(config)) {
      const item = section.items.find((candidate) => itemPaths(candidate).includes(pathname));
      if (item) return { item, section: section.name };
    }
    return null;
  }

  function isItemAllowed(item, section, permissions = {}, settings = {}) {
    if (!item || item.href === LOGOUT_VALUE) return true;
    if (item.permission && !permissions[item.permission]) return false;
    const hiddenKey = section === "goto" ? "hiddenGotoMenu" : "hiddenBackofficeMenu";
    const blockedKey = section === "goto" ? "blockedGotoMenu" : "blockedBackofficeMenu";
    const hidden = Array.isArray(settings[hiddenKey]) ? settings[hiddenKey] : [];
    const blocked = Array.isArray(settings[blockedKey]) ? settings[blockedKey] : [];
    return !hidden.includes(item.href) && !blocked.includes(item.href);
  }

  function isPathAllowed(pathname, config, permissions, settings) {
    const match = findItemForPath(pathname, config);
    return !match || isItemAllowed(match.item, match.section, permissions, settings);
  }

  function firstAllowedPath(config, permissions, settings) {
    for (const section of configuredSections(config)) {
      const item = section.items.find((candidate) =>
        candidate.href &&
        candidate.href !== LOGOUT_VALUE &&
        isItemAllowed(candidate, section.name, permissions, settings)
      );
      if (item?.href) return item.href;
    }
    return "/";
  }

  globalObject.MJScreenAccess = {
    LOGOUT_VALUE,
    findItemForPath,
    firstAllowedPath,
    isItemAllowed,
    isPathAllowed,
    itemPaths
  };
}(window));
