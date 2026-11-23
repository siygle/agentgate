(function () {
  "use strict";

  var STORAGE_KEY = "agentgate-settings";

  var DEFAULTS = {
    theme: "system",
    fontSize: "medium",
    fontFamily: "system",
  };

  var CODE_FONT_SIZES = {
    small: "0.75rem",
    medium: "0.8125rem",
    large: "0.9375rem",
  };

  var CONTENT_FONT_SIZES = {
    small: "0.875rem",
    medium: "0.9375rem",
    large: "1.0625rem",
  };

  var FONT_FAMILIES = {
    system: "",
    "JetBrains Mono": "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
    "Fira Code": "'Fira Code', ui-monospace, SFMono-Regular, monospace",
    "Source Code Pro": "'Source Code Pro', ui-monospace, SFMono-Regular, monospace",
  };

  // These used to be pulled from fonts.googleapis.com on demand. Two reasons they are
  // not any more: this page holds the decryption key and the remembered passphrase, so
  // a third-party request from it is worth avoiding; and share content now renders in a
  // sandbox with `font-src data:`, where a webfont URL cannot load at all. The stacks
  // above therefore apply only when the font is installed locally, and fall back to the
  // system monospace otherwise — which is why the panel says so.

  function loadSettings() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        return {
          theme: parsed.theme || DEFAULTS.theme,
          fontSize: parsed.fontSize || DEFAULTS.fontSize,
          fontFamily: parsed.fontFamily || DEFAULTS.fontFamily,
        };
      }
    } catch (e) {
      // ignore
    }
    return Object.assign({}, DEFAULTS);
  }

  function saveSettings(settings) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      // ignore
    }
  }

  function t(key, fallback) {
    return window.AgentGateI18n ? window.AgentGateI18n.t(key) : fallback;
  }

  function applyTheme(theme) {
    var html = document.documentElement;
    if (theme === "light" || theme === "dark") {
      html.setAttribute("data-theme", theme);
    } else {
      html.removeAttribute("data-theme");
    }
    // Highlight.js CSS lives inside the render sandbox; sandbox.js's BRIDGE_SOURCE
    // updates the inlined highlight-dark-css <style media> when it receives settings.
  }

  function applyFontSize(size) {
    var codeValue = CODE_FONT_SIZES[size] || CODE_FONT_SIZES.medium;
    var contentValue = CONTENT_FONT_SIZES[size] || CONTENT_FONT_SIZES.medium;
    document.documentElement.style.setProperty("--code-font-size", codeValue);
    document.documentElement.style.setProperty("--content-font-size", contentValue);
  }

  function applyFontFamily(family) {
    var value = FONT_FAMILIES[family];
    if (value) {
      document.documentElement.style.setProperty("--code-font-family", value);
      document.documentElement.style.setProperty("--content-font-family", value);
    } else {
      document.documentElement.style.removeProperty("--code-font-family");
      document.documentElement.style.removeProperty("--content-font-family");
    }
  }

  function applyAll(settings) {
    applyTheme(settings.theme);
    applyFontSize(settings.fontSize);
    applyFontFamily(settings.fontFamily);
  }

  // --- sharing settings with the render sandbox --------------------------------------

  // Share content renders inside an iframe, which cannot read this page's DOM or
  // localStorage. describe() reduces the settings to the theme plus the CSS custom
  // properties tokens.css/renderer.css actually read, so the host can post them across
  // and the frame can apply them without knowing anything about this module.
  function describe(settings) {
    var s = settings || loadSettings();
    var family = FONT_FAMILIES[s.fontFamily] || "";
    var lang = window.AgentGateI18n ? window.AgentGateI18n.getLocale() : "en";
    return {
      theme: s.theme,
      lang: lang,
      vars: {
        "--code-font-size": CODE_FONT_SIZES[s.fontSize] || CODE_FONT_SIZES.medium,
        "--content-font-size": CONTENT_FONT_SIZES[s.fontSize] || CONTENT_FONT_SIZES.medium,
        "--code-font-family": family,
        "--content-font-family": family,
      },
    };
  }

  var listeners = [];

  function onChange(fn) {
    if (typeof fn === "function") listeners.push(fn);
  }

  function notify(settings) {
    var described = describe(settings);
    listeners.forEach(function (fn) {
      try {
        fn(described);
      } catch (e) {
        console.error("settings listener failed", e);
      }
    });
  }

  function gearSvg() {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="12" cy="12" r="3"></circle>' +
      '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>' +
      "</svg>"
    );
  }

  function buildOptionGroup(options, currentValue, onChange) {
    var group = document.createElement("div");
    group.className = "settings-options";
    options.forEach(function (opt) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "settings-option" + (opt.value === currentValue ? " active" : "");
      btn.setAttribute("data-opt-value", opt.value);
      if (opt.i18nKey) btn.setAttribute("data-i18n", opt.i18nKey);
      btn.textContent = opt.i18nKey ? t(opt.i18nKey, opt.label) : opt.label;
      btn.addEventListener("click", function () {
        group.querySelectorAll(".settings-option").forEach(function (el) {
          el.classList.remove("active");
        });
        btn.classList.add("active");
        onChange(opt.value);
      });
      group.appendChild(btn);
    });
    return group;
  }

  function renderSettingsPanel(container) {
    var settings = loadSettings();
    var trigger = document.createElement("div");
    trigger.className = "settings-trigger";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "settings-btn";
    btn.setAttribute("data-i18n-title", "settings.title");
    btn.title = t("settings.title", "Display settings");
    btn.innerHTML = gearSvg();
    trigger.appendChild(btn);

    var panel = document.createElement("div");
    panel.className = "settings-panel";
    panel.style.display = "none";

    // Language
    if (window.AgentGateI18n) {
      var langSection = document.createElement("div");
      langSection.className = "settings-section";
      var langLabel = document.createElement("span");
      langLabel.className = "settings-label";
      langLabel.setAttribute("data-i18n", "lang.label");
      langLabel.textContent = t("lang.label", "Language");
      langSection.appendChild(langLabel);
      var langGroup = buildOptionGroup(
        [
          { label: "English", value: "en" },
          { label: "繁體中文", value: "zh-TW" },
        ],
        window.AgentGateI18n.getLocale(),
        function (value) {
          window.AgentGateI18n.setLocale(value);
          notify(settings);
        }
      );
      window.AgentGateI18n.onChange(function (loc) {
        langGroup.querySelectorAll(".settings-option").forEach(function (el) {
          el.classList.toggle("active", el.getAttribute("data-opt-value") === loc);
        });
      });
      langSection.appendChild(langGroup);
      panel.appendChild(langSection);
    }

    // Theme
    var themeSection = document.createElement("div");
    themeSection.className = "settings-section";
    var themeLabel = document.createElement("span");
    themeLabel.className = "settings-label";
    themeLabel.setAttribute("data-i18n", "settings.theme");
    themeLabel.textContent = t("settings.theme", "Theme");
    themeSection.appendChild(themeLabel);
    themeSection.appendChild(
      buildOptionGroup(
        [
          { label: "System", i18nKey: "settings.themeSystem", value: "system" },
          { label: "Light", i18nKey: "settings.themeLight", value: "light" },
          { label: "Dark", i18nKey: "settings.themeDark", value: "dark" },
        ],
        settings.theme,
        function (value) {
          settings.theme = value;
          saveSettings(settings);
          applyTheme(value);
          notify(settings);
        }
      )
    );
    panel.appendChild(themeSection);

    // Font Size
    var sizeSection = document.createElement("div");
    sizeSection.className = "settings-section";
    var sizeLabel = document.createElement("span");
    sizeLabel.className = "settings-label";
    sizeLabel.setAttribute("data-i18n", "settings.fontSize");
    sizeLabel.textContent = t("settings.fontSize", "Font Size");
    sizeSection.appendChild(sizeLabel);
    sizeSection.appendChild(
      buildOptionGroup(
        [
          { label: "Small", i18nKey: "settings.sizeSmall", value: "small" },
          { label: "Medium", i18nKey: "settings.sizeMedium", value: "medium" },
          { label: "Large", i18nKey: "settings.sizeLarge", value: "large" },
        ],
        settings.fontSize,
        function (value) {
          settings.fontSize = value;
          saveSettings(settings);
          applyFontSize(value);
          notify(settings);
        }
      )
    );
    panel.appendChild(sizeSection);

    // Font Family
    var familySection = document.createElement("div");
    familySection.className = "settings-section";
    var familyLabel = document.createElement("span");
    familyLabel.className = "settings-label";
    familyLabel.setAttribute("data-i18n", "settings.font");
    familyLabel.textContent = t("settings.font", "Font");
    familySection.appendChild(familyLabel);
    familySection.appendChild(
      buildOptionGroup(
        [
          { label: "System", i18nKey: "settings.fontSystem", value: "system" },
          { label: "JetBrains", value: "JetBrains Mono" },
          { label: "Fira", value: "Fira Code" },
          { label: "Source", value: "Source Code Pro" },
        ],
        settings.fontFamily,
        function (value) {
          settings.fontFamily = value;
          saveSettings(settings);
          applyFontFamily(value);
          notify(settings);
        }
      )
    );
    var familyHint = document.createElement("p");
    familyHint.className = "settings-hint";
    familyHint.setAttribute("data-i18n", "settings.fontHint");
    familyHint.textContent = t("settings.fontHint", "Applies if the font is installed on this device.");
    familySection.appendChild(familyHint);
    panel.appendChild(familySection);

    trigger.appendChild(panel);

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var isOpen = panel.style.display !== "none";
      panel.style.display = isOpen ? "none" : "";
    });

    document.addEventListener("click", function (e) {
      if (!trigger.contains(e.target)) {
        panel.style.display = "none";
      }
    });

    container.appendChild(trigger);
  }

  function init() {
    applyAll(loadSettings());
  }

  window.AgentGateSettings = {
    init: init,
    renderSettingsPanel: renderSettingsPanel,
    // describe/onChange let the host forward display settings into the render sandbox,
    // which has no access to this page's DOM or localStorage.
    describe: describe,
    onChange: onChange,
  };
})();
