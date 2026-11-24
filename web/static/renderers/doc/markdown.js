(function () {
  "use strict";

  var MD_EXTENSIONS = { md: true, mdx: true, markdown: true };

  function isMarkdown(filename) {
    var ext = (filename || "").split(".").pop().toLowerCase();
    return MD_EXTENSIONS.hasOwnProperty(ext);
  }

  function stripFrontmatter(content) {
    if (typeof content !== "string") return content;
    if (!content.startsWith("---\n")) return content;
    var end = content.indexOf("\n---\n", 4);
    if (end === -1) return content;
    return content.slice(end + 5);
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/'/g, "&#39;");
  }

  function parseAttrs(src) {
    var attrs = {};
    String(src || "").replace(/(\w+)=(?:"([^"]*)"|'([^']*)')/g, function (_, key, dq, sq) {
      attrs[key] = dq != null ? dq : sq;
      return "";
    });
    return attrs;
  }

  function extractBalanced(src, start, openChar, closeChar) {
    var depth = 0;
    var quote = null;
    var template = false;
    for (var i = start; i < src.length; i++) {
      var ch = src[i];
      var prev = src[i - 1];
      if (quote) {
        if (ch === quote && prev !== "\\") quote = null;
        continue;
      }
      if (template) {
        if (ch === "`" && prev !== "\\") template = false;
        continue;
      }
      if (ch === "\"" || ch === "'") { quote = ch; continue; }
      if (ch === "`") { template = true; continue; }
      if (ch === openChar) depth++;
      else if (ch === closeChar) {
        depth--;
        if (depth === 0) return { value: src.slice(start + 1, i), end: i + 1 };
      }
    }
    return null;
  }

  function propExpr(attrText, name) {
    var marker = name + "={";
    var idx = attrText.indexOf(marker);
    if (idx === -1) return null;
    return extractBalanced(attrText, idx + name.length + 1, "{", "}");
  }

  function evalMdxExpr(expr) {
    // Visual-plan MDX props are data literals (arrays/objects/template strings).
    // They are authored by the agent and encrypted with the share. Evaluating only
    // those prop expressions lets AgentGate preview rich MDX without a full React
    // runtime or bundler.
    try { return (new Function("return (" + expr + ");"))(); } catch (e) { return null; }
  }

  function mdTable(headers, rows) {
    var out = ["| " + headers.join(" | ") + " |", "| " + headers.map(function () { return "---"; }).join(" | ") + " |"];
    (rows || []).forEach(function (row) {
      out.push("| " + row.map(function (cell) { return String(cell == null ? "" : cell).replace(/\|/g, "\\|").replace(/\n/g, "<br>"); }).join(" | ") + " |");
    });
    return out.join("\n");
  }

  function renderDataModel(attrText) {
    var entitiesExpr = propExpr(attrText, "entities");
    var relationsExpr = propExpr(attrText, "relations");
    var entities = entitiesExpr ? evalMdxExpr(entitiesExpr.value) : null;
    var relations = relationsExpr ? evalMdxExpr(relationsExpr.value) : null;
    if (!Array.isArray(entities)) return "\n```mdx\n<DataModel" + attrText + "/>\n```\n";
    var out = ["\n<div class=\"mdx-card mdx-data-model\">\n\n### Data Model\n"];
    entities.forEach(function (entity) {
      out.push("\n#### " + (entity.name || entity.id || "Entity") + "\n");
      out.push(mdTable(["Field", "Type", "Notes"], (entity.fields || []).map(function (f) {
        var notes = [];
        if (f.pk) notes.push("PK");
        if (f.fk) notes.push("FK → `" + f.fk + "`");
        if (f.nullable) notes.push("nullable");
        return ["`" + (f.name || "") + "`", f.type || "", notes.join(", ")];
      })));
      out.push("\n");
    });
    if (Array.isArray(relations) && relations.length) {
      out.push("\n#### Relations\n");
      out.push(mdTable(["From", "To", "Kind"], relations.map(function (r) { return ["`" + r.from + "`", "`" + r.to + "`", r.kind || ""]; })));
    }
    out.push("\n</div>\n");
    return out.join("\n");
  }

  function renderEndpoint(openTag, body) {
    var attrs = parseAttrs(openTag);
    var paramsExpr = propExpr(openTag, "params");
    var responsesExpr = propExpr(openTag, "responses");
    var requestExpr = propExpr(openTag, "request");
    var params = paramsExpr ? evalMdxExpr(paramsExpr.value) : null;
    var responses = responsesExpr ? evalMdxExpr(responsesExpr.value) : null;
    var request = requestExpr ? evalMdxExpr(requestExpr.value) : null;
    var method = (attrs.method || "HTTP").toUpperCase();
    var path = attrs.path || "";
    var out = ["\n<div class=\"mdx-card mdx-endpoint\">\n"];
    out.push("\n### `" + method + "` " + path + "\n");
    if (attrs.summary) out.push("\n" + attrs.summary + "\n");
    out.push("\n- **Auth:** " + (attrs.auth || "—") + (attrs.change ? "\n- **Change:** `" + attrs.change + "`" : "") + "\n");
    if (Array.isArray(params) && params.length) {
      out.push("\n#### Parameters\n");
      out.push(mdTable(["Name", "In", "Type", "Required", "Description"], params.map(function (p) { return ["`" + (p.name || "") + "`", p.in || "", p.type || "", p.required ? "yes" : "", p.description || ""]; })));
    }
    if (request && request.example) out.push("\n#### Request\n\n```json\n" + request.example + "\n```\n");
    if (Array.isArray(responses) && responses.length) {
      out.push("\n#### Responses\n");
      out.push(mdTable(["Status", "Description", "Example"], responses.map(function (r) { return [r.status || "", r.description || "", r.example ? "`" + r.example + "`" : ""]; })));
    }
    if (body && body.trim()) out.push("\n" + body.trim() + "\n");
    out.push("\n</div>\n");
    return out.join("\n");
  }

  function preprocessMdx(content) {
    var text = stripFrontmatter(content || "");

    text = text.replace(/<Callout\b([^>]*)>([\s\S]*?)<\/Callout>/g, function (_, attrText, body) {
      var attrs = parseAttrs(attrText);
      var tone = attrs.tone ? " [" + attrs.tone + "]" : "";
      var lines = (body || "").trim().split(/\r?\n/).map(function (line) { return line ? "> " + line : ">"; }).join("\n");
      return "\n> **Callout" + tone + "**\n" + lines + "\n";
    });

    text = text.replace(/<Mermaid\b([\s\S]*?)\/>/g, function (_, attrText) {
      var attrs = parseAttrs(attrText);
      var src = propExpr(attrText, "source");
      var value = src ? evalMdxExpr(src.value) : "";
      var caption = attrs.caption ? "\n**" + attrs.caption + "**\n\n" : "";
      return caption + "```mermaid\n" + (value || "") + "\n```\n";
    });

    text = text.replace(/<DataModel\b([\s\S]*?)\/>/g, function (_, attrText) {
      return renderDataModel(attrText);
    });

    text = text.replace(/<Endpoint\b([\s\S]*?)>([\s\S]*?)<\/Endpoint>/g, function (_, openTag, body) {
      return renderEndpoint(openTag, body);
    });

    text = text.replace(/<Diagram\b([^>]*)>([\s\S]*?)<\/Diagram>/g, function (_, attrText, body) {
      var attrs = parseAttrs(attrText);
      var match = (body || "").match(/```html\n([\s\S]*?)\n```/i);
      if (!match) return body;
      return "\n<div class=\"mdx-card mdx-diagram\">" + (attrs.caption ? "<div class=\"mdx-caption\">" + escapeHtml(attrs.caption) + "</div>" : "") + match[1] + "</div>\n";
    });

    return text;
  }

  // protectMath pulls LaTeX math out of markdown prose before marked runs, so
  // underscores, asterisks, and backslashes inside expressions are not mangled by
  // markdown emphasis or escaping. Fenced code blocks and inline code spans are left
  // completely untouched.
  function protectMath(text) {
    var tokens = [];
    function stash(tex, display) {
      var idx = tokens.length;
      tokens.push({ tex: tex.trim(), display: !!display });
      return "@@AG_MATH_" + idx + "@@";
    }

    // Split by fenced code blocks first so math inside ```...``` / ~~~...~~~ is untouched.
    var lines = String(text || "").split("\n");
    var out = [];
    var buf = [];
    var fenceChar = "";
    var fenceLen = 0;

    function flushProse() {
      if (!buf.length) return;
      var chunk = buf.join("\n");
      buf = [];
      // Protect inline code spans (`...`) while transforming surrounding prose.
      var parts = chunk.split(/(`+[^`]*`+)/g);
      for (var p = 0; p < parts.length; p++) {
        if (p % 2 === 1) continue;
        var s = parts[p];
        s = s.replace(/\$\$([\s\S]+?)\$\$/g, function (_, tex) {
          return "\n\n" + stash(tex, true) + "\n\n";
        });
        s = s.replace(/\\\[([\s\S]+?)\\\]/g, function (_, tex) {
          return "\n\n" + stash(tex, true) + "\n\n";
        });
        s = s.replace(/\\\(([\s\S]+?)\\\)/g, function (_, tex) {
          return stash(tex, false);
        });
        s = s.replace(/(^|[^\\$])\$([^\s$](?:[^$\n]*?[^\s$])?)\$(?![$\d])/g, function (_, lead, tex) {
          return lead + stash(tex, false);
        });
        parts[p] = s;
      }
      out.push(parts.join(""));
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var m = line.match(/^\s*(`{3,}|~{3,})/);
      if (!fenceChar && m) {
        flushProse();
        fenceChar = m[1].charAt(0);
        fenceLen = m[1].length;
        out.push(line);
      } else if (fenceChar) {
        out.push(line);
        var closeRe = new RegExp("^\\s*" + fenceChar + "{" + fenceLen + ",}\\s*$");
        if (closeRe.test(line)) {
          fenceChar = "";
          fenceLen = 0;
        }
      } else {
        buf.push(line);
      }
    }
    flushProse();
    return { text: out.join("\n"), tokens: tokens };
  }

  function restoreMath(html, tokens) {
    if (!tokens || !tokens.length) return html;
    var out = String(html || "");
    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i];
      var encoded = encodeURIComponent(tok.tex).replace(/"/g, "%22");
      var placeholder = "@@AG_MATH_" + i + "@@";
      if (tok.display) {
        var blockHtml =
          '<div class="ag-math-block" data-ag-math-display="1" data-ag-math="' +
          encoded +
          '">' +
          escapeHtml(tok.tex) +
          "</div>";
        out = out.replace("<p>" + placeholder + "</p>", blockHtml);
        out = out.replace(placeholder, blockHtml);
      } else {
        var inlineHtml =
          '<span class="ag-math-inline" data-ag-math-display="0" data-ag-math="' +
          encoded +
          '">' +
          escapeHtml(tok.tex) +
          "</span>";
        out = out.replace(placeholder, inlineHtml);
      }
    }
    return out;
  }

  function renderMarkdown(content) {
    var prepared = preprocessMdx(content);
    var protectedMath = protectMath(prepared);
    if (typeof marked !== "undefined") {
      return restoreMath(marked.parse(protectedMath.text), protectedMath.tokens);
    }
    return prepared;
  }
  // Configure marked with highlight.js integration
  if (typeof marked !== "undefined") {
    marked.use({
      renderer: {
        code: function (token) {
          var lang = token.lang;
          var code = token.text;
          var normalizedLang = (lang || "").toLowerCase();
          if (normalizedLang === "mermaid") {
            return '<div class="mermaid">' + code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</div>";
          }
          if (normalizedLang === "math" || normalizedLang === "latex" || normalizedLang === "katex") {
            var encoded = encodeURIComponent(String(code || "").trim()).replace(/"/g, "%22");
            return '<div class="ag-math-block" data-ag-math-display="1" data-ag-math="' + encoded + '">' + escapeHtml(code) + "</div>";
          }
          if (normalizedLang === "wireframe" || normalizedLang === "html-wireframe") {
            return '<div class="plan-wireframe-source" data-wireframe="' + encodeURIComponent(code).replace(/"/g, "%22") + '"></div>';
          }
          var highlighted;
          if (
            lang &&
            typeof hljs !== "undefined" &&
            hljs.getLanguage(lang)
          ) {
            highlighted = hljs.highlight(code, { language: lang }).value;
          } else if (typeof hljs !== "undefined") {
            highlighted = hljs.highlightAuto(code).value;
          } else {
            highlighted = code;
          }
          return '<pre><code class="hljs">' + highlighted + "</code></pre>";
        },
      },
    });
  }

  window.AgentGateMarkdown = {
    isMarkdown: isMarkdown,
    stripFrontmatter: stripFrontmatter,
    protectMath: protectMath,
    restoreMath: restoreMath,
    renderMarkdown: renderMarkdown,
  };
})();
