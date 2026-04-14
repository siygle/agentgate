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

  function renderMarkdown(content) {
    var stripped = stripFrontmatter(content);
    if (typeof marked !== "undefined") {
      return marked.parse(stripped);
    }
    return stripped;
  }

  // Configure marked with highlight.js integration
  if (typeof marked !== "undefined") {
    marked.use({
      renderer: {
        code: function (token) {
          var lang = token.lang;
          var code = token.text;
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

  window.DiffminiMarkdown = {
    isMarkdown: isMarkdown,
    stripFrontmatter: stripFrontmatter,
    renderMarkdown: renderMarkdown,
  };
})();
