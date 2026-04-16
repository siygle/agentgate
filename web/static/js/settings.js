(function () {
  "use strict";

  var STORAGE_KEY = "agentgate-settings";

  var DEFAULTS = {
    theme: "system",
    fontSize: "medium",
    fontFamily: "system",
  };

  var FONT_SIZES = {
    small: "0.75rem",
    medium: "0.8125rem",
    large: "0.9375rem",
  };

  var FONT_FAMILIES = {
    system: "",
    "JetBrains Mono": "'JetBrains Mono', monospace",
    "Fira Code": "'Fira Code', monospace",
    "Source Code Pro": "'Source Code Pro', monospace",
  };

  var GOOGLE_FONT_URLS = {
    "JetBrains Mono":
      "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap",
    "Fira Code":
      "https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&display=swap",
    "Source Code Pro":
      "https://fonts.googleapis.com/css2?family=Source+Code+Pro:wght@400;500;600&display=swap",
  };

  var loadedFonts = {};

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

  function applyTheme(theme) {
    var html = document.documentElement;
    if (theme === "light" || theme === "dark") {
      html.setAttribute("data-theme", theme);
    } else {
      html.removeAttribute("data-theme");
    }

    // Update highlight.js dark theme link to match manual override
    var darkHlLink = document.querySelector(
      'link[href*="highlight-github-dark"]'
    );
    if (darkHlLink) {
      if (theme === "light") {
        darkHlLink.media = "not all";
      } else if (theme === "dark") {
        darkHlLink.media = "all";
      } else {
        darkHlLink.media = "(prefers-color-scheme: dark)";
      }
    }
  }

  function applyFontSize(size) {
    var value = FONT_SIZES[size] || FONT_SIZES.medium;
    document.documentElement.style.setProperty("--code-font-size", value);
  }

  function loadGoogleFont(name) {
    var url = GOOGLE_FONT_URLS[name];
    if (!url || loadedFonts[name]) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    document.head.appendChild(link);
    loadedFonts[name] = true;
  }

  function applyFontFamily(family) {
    var value = FONT_FAMILIES[family];
    if (value) {
      loadGoogleFont(family);
      document.documentElement.style.setProperty("--code-font-family", value);
    } else {
      document.documentElement.style.removeProperty("--code-font-family");
    }
  }

  function applyAll(settings) {
    applyTheme(settings.theme);
    applyFontSize(settings.fontSize);
    applyFontFamily(settings.fontFamily);
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
      btn.className = "settings-option" + (opt.value === currentValue ? " active" : "");
      btn.textContent = opt.label;
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
    btn.className = "settings-btn";
    btn.title = "Display settings";
    btn.innerHTML = gearSvg();
    trigger.appendChild(btn);

    var panel = document.createElement("div");
    panel.className = "settings-panel";
    panel.style.display = "none";

    // Theme
    var themeSection = document.createElement("div");
    themeSection.className = "settings-section";
    var themeLabel = document.createElement("span");
    themeLabel.className = "settings-label";
    themeLabel.textContent = "Theme";
    themeSection.appendChild(themeLabel);
    themeSection.appendChild(
      buildOptionGroup(
        [
          { label: "System", value: "system" },
          { label: "Light", value: "light" },
          { label: "Dark", value: "dark" },
        ],
        settings.theme,
        function (value) {
          settings.theme = value;
          saveSettings(settings);
          applyTheme(value);
        }
      )
    );
    panel.appendChild(themeSection);

    // Font Size
    var sizeSection = document.createElement("div");
    sizeSection.className = "settings-section";
    var sizeLabel = document.createElement("span");
    sizeLabel.className = "settings-label";
    sizeLabel.textContent = "Font Size";
    sizeSection.appendChild(sizeLabel);
    sizeSection.appendChild(
      buildOptionGroup(
        [
          { label: "Small", value: "small" },
          { label: "Medium", value: "medium" },
          { label: "Large", value: "large" },
        ],
        settings.fontSize,
        function (value) {
          settings.fontSize = value;
          saveSettings(settings);
          applyFontSize(value);
        }
      )
    );
    panel.appendChild(sizeSection);

    // Font Family
    var familySection = document.createElement("div");
    familySection.className = "settings-section";
    var familyLabel = document.createElement("span");
    familyLabel.className = "settings-label";
    familyLabel.textContent = "Font";
    familySection.appendChild(familyLabel);
    familySection.appendChild(
      buildOptionGroup(
        [
          { label: "System", value: "system" },
          { label: "JetBrains", value: "JetBrains Mono" },
          { label: "Fira", value: "Fira Code" },
          { label: "Source", value: "Source Code Pro" },
        ],
        settings.fontFamily,
        function (value) {
          settings.fontFamily = value;
          saveSettings(settings);
          applyFontFamily(value);
        }
      )
    );
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
  };
})();
