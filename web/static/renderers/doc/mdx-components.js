(function () {
  "use strict";

  // The MDX component set for visual plans, plus the render entry point.
  //
  // This used to be web/static/js/mdx-runtime.js, which imported React and
  // @mdx-js/mdx straight from esm.sh — around 200 third-party requests on the page
  // holding the decryption key, and impossible inside the render sandbox, which allows
  // no network at all. The libraries now arrive as one vendored bundle
  // (agentgate:mdx, built by tools/mdx-bundle) that exposes AgentGateMDXVendor.
  //
  // These components stay outside that bundle deliberately: they are AgentGate's own
  // code, and editing one should not require re-running a build.

  var V = window.AgentGateMDXVendor;
  if (!V) {
    // The bundle was not inlined (payload has no .mdx, or it failed to load). The
    // renderer falls back to markdown.js's regex preprocessing, which handles the same
    // Callout/Mermaid/DataModel/Endpoint tags in a simpler way.
    return;
  }

  var React = V.React;

  function stripFrontmatter(content) {
    if (window.AgentGateMarkdown && window.AgentGateMarkdown.stripFrontmatter) {
      return window.AgentGateMarkdown.stripFrontmatter(content || "");
    }
    return content || "";
  }

  function textOf(value) {
    if (value == null || value === false) return "";
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(textOf).join("");
    if (React.isValidElement(value)) return textOf(value.props && value.props.children);
    return "";
  }

  function flatten(value, out) {
    if (value == null || value === false) return out;
    if (Array.isArray(value)) {
      value.forEach(function (v) {
        flatten(v, out);
      });
    } else {
      out.push(value);
    }
    return out;
  }

  function codeBlocks(children) {
    var blocks = [];
    flatten(children, []).forEach(function visit(node) {
      if (!React.isValidElement(node)) return;
      if (node.type === "pre") {
        var child = React.Children.toArray(node.props.children)[0];
        if (React.isValidElement(child) && child.type === "code") {
          blocks.push({ className: child.props.className || "", code: textOf(child.props.children) });
        }
        return;
      }
      React.Children.toArray(node.props.children).forEach(visit);
    });
    return blocks;
  }

  function Table(props) {
    var headers = props.headers || [];
    var rows = props.rows || [];
    return React.createElement(
      "div",
      { className: "mdx-table-wrap" },
      React.createElement(
        "table",
        null,
        React.createElement(
          "thead",
          null,
          React.createElement(
            "tr",
            null,
            headers.map(function (h) {
              return React.createElement("th", { key: h }, h);
            })
          )
        ),
        React.createElement(
          "tbody",
          null,
          rows.map(function (row, i) {
            return React.createElement(
              "tr",
              { key: i },
              row.map(function (cell, j) {
                return React.createElement("td", { key: j }, cell == null ? "" : String(cell));
              })
            );
          })
        )
      )
    );
  }

  function Callout(props) {
    var tone = props.tone || "info";
    return React.createElement(
      "aside",
      { className: "mdx-callout mdx-callout-" + tone },
      React.createElement("div", { className: "mdx-callout-label" }, tone),
      React.createElement("div", { className: "mdx-callout-body" }, props.children)
    );
  }

  function DataModel(props) {
    var entities = Array.isArray(props.entities) ? props.entities : [];
    var relations = Array.isArray(props.relations) ? props.relations : [];
    return React.createElement(
      "section",
      { className: "mdx-card mdx-data-model", id: props.id },
      React.createElement("h3", null, "Data Model"),
      entities.map(function (entity) {
        return React.createElement(
          "section",
          { key: entity.id || entity.name, className: "mdx-entity" },
          React.createElement("h4", null, entity.name || entity.id || "Entity"),
          React.createElement(Table, {
            headers: ["Field", "Type", "Notes"],
            rows: (entity.fields || []).map(function (f) {
              var notes = [];
              if (f.pk) notes.push("PK");
              if (f.fk) notes.push("FK → " + f.fk);
              if (f.nullable) notes.push("nullable");
              return [f.name || "", f.type || "", notes.join(", ")];
            }),
          })
        );
      }),
      relations.length
        ? React.createElement(
            React.Fragment,
            null,
            React.createElement("h4", null, "Relations"),
            React.createElement(Table, {
              headers: ["From", "To", "Kind"],
              rows: relations.map(function (r) {
                return [r.from || "", r.to || "", r.kind || ""];
              }),
            })
          )
        : null
    );
  }

  function Endpoint(props) {
    return React.createElement(
      "section",
      { className: "mdx-card mdx-endpoint", id: props.id },
      React.createElement(
        "div",
        { className: "mdx-endpoint-head" },
        React.createElement(
          "span",
          { className: "mdx-method mdx-method-" + String(props.method || "GET").toLowerCase() },
          props.method || "HTTP"
        ),
        React.createElement("code", { className: "mdx-path" }, props.path || ""),
        props.change ? React.createElement("span", { className: "mdx-change" }, props.change) : null
      ),
      props.summary ? React.createElement("p", { className: "mdx-summary" }, props.summary) : null,
      props.auth
        ? React.createElement("p", { className: "mdx-auth" }, "Auth: ", React.createElement("strong", null, props.auth))
        : null,
      Array.isArray(props.params) && props.params.length
        ? React.createElement(
            React.Fragment,
            null,
            React.createElement("h4", null, "Parameters"),
            React.createElement(Table, {
              headers: ["Name", "In", "Type", "Required", "Description"],
              rows: props.params.map(function (p) {
                return [p.name || "", p.in || "", p.type || "", p.required ? "yes" : "", p.description || ""];
              }),
            })
          )
        : null,
      props.request
        ? React.createElement(
            React.Fragment,
            null,
            React.createElement("h4", null, "Request"),
            React.createElement(
              "pre",
              null,
              React.createElement(
                "code",
                { className: "language-json" },
                props.request.example || JSON.stringify(props.request, null, 2)
              )
            )
          )
        : null,
      Array.isArray(props.responses) && props.responses.length
        ? React.createElement(
            React.Fragment,
            null,
            React.createElement("h4", null, "Responses"),
            React.createElement(Table, {
              headers: ["Status", "Description", "Example"],
              rows: props.responses.map(function (r) {
                return [r.status || "", r.description || "", r.example || ""];
              }),
            })
          )
        : null,
      props.children ? React.createElement("div", { className: "mdx-endpoint-body" }, props.children) : null
    );
  }

  function Mermaid(props) {
    return React.createElement(
      "figure",
      { className: "mdx-card mdx-mermaid", id: props.id },
      props.caption ? React.createElement("figcaption", { className: "mdx-caption" }, props.caption) : null,
      React.createElement("div", { className: "mermaid" }, props.source || textOf(props.children))
    );
  }

  function Diagram(props) {
    var blocks = codeBlocks(props.children);
    var html = (blocks.find(function (b) {
      return /language-html/.test(b.className);
    }) || {}).code;
    var css = (blocks.find(function (b) {
      return /language-css/.test(b.className);
    }) || {}).code;
    return React.createElement(
      "figure",
      { className: "mdx-card mdx-diagram", id: props.id },
      props.caption ? React.createElement("figcaption", { className: "mdx-caption" }, props.caption) : null,
      css ? React.createElement("style", null, css) : null,
      // dangerouslySetInnerHTML is safe here in a way it would not be on the host page:
      // this runs inside the opaque-origin sandbox with connect-src 'none', so injected
      // markup can reach neither the decryption key nor the network.
      html ? React.createElement("div", { dangerouslySetInnerHTML: { __html: html } }) : props.children
    );
  }

  function FileTree(props) {
    var entries = Array.isArray(props.entries) ? props.entries : [];
    return React.createElement(
      "section",
      { className: "mdx-card mdx-file-tree", id: props.id },
      React.createElement("h3", null, props.title || "Files"),
      React.createElement(
        "ul",
        null,
        entries.map(function (e) {
          return React.createElement(
            "li",
            { key: e.path },
            React.createElement("code", null, e.path),
            " ",
            e.change ? React.createElement("span", { className: "mdx-change" }, e.change) : null,
            e.note ? React.createElement("div", { className: "mdx-note" }, e.note) : null
          );
        })
      )
    );
  }

  function AnnotatedCode(props) {
    return React.createElement(
      "section",
      { className: "mdx-card mdx-annotated-code", id: props.id },
      React.createElement("h3", null, props.filename || "Code"),
      React.createElement(
        "pre",
        null,
        React.createElement("code", { className: "language-" + (props.language || "") }, props.code || "")
      ),
      Array.isArray(props.annotations) && props.annotations.length
        ? React.createElement(
            "ul",
            { className: "mdx-annotations" },
            props.annotations.map(function (a, i) {
              return React.createElement(
                "li",
                { key: i },
                React.createElement("strong", null, a.label || a.lines || "Note"),
                a.lines ? " (" + a.lines + ")" : "",
                a.note ? ": " + a.note : ""
              );
            })
          )
        : null
    );
  }

  function Diff(props) {
    return React.createElement(
      "section",
      { className: "mdx-card mdx-diff", id: props.id },
      React.createElement("h3", null, props.filename || "Diff"),
      React.createElement(
        "div",
        { className: "mdx-diff-grid" },
        React.createElement(
          "div",
          null,
          React.createElement("h4", null, "Before"),
          React.createElement(
            "pre",
            null,
            React.createElement("code", { className: "language-" + (props.language || "") }, props.before || "")
          )
        ),
        React.createElement(
          "div",
          null,
          React.createElement("h4", null, "After"),
          React.createElement(
            "pre",
            null,
            React.createElement("code", { className: "language-" + (props.language || "") }, props.after || "")
          )
        )
      )
    );
  }

  function Checklist(props) {
    var items = Array.isArray(props.items) ? props.items : [];
    return React.createElement(
      "section",
      { className: "mdx-card mdx-checklist", id: props.id },
      React.createElement(
        "ul",
        null,
        items.map(function (item) {
          return React.createElement(
            "li",
            { key: item.id || item.label },
            React.createElement("input", { type: "checkbox", checked: !!item.checked, readOnly: true }),
            " ",
            item.label || ""
          );
        })
      )
    );
  }

  function QuestionForm(props) {
    var questions = Array.isArray(props.questions) ? props.questions : [];
    return React.createElement(
      "section",
      { className: "mdx-card mdx-question-form", id: props.id },
      questions.map(function (q) {
        return React.createElement(
          "div",
          { key: q.id, className: "mdx-question" },
          React.createElement("h4", null, q.title || q.id),
          (q.options || []).map(function (opt) {
            return React.createElement(
              "label",
              { key: opt.id, className: "mdx-option" },
              React.createElement("input", {
                type: q.mode === "multi" ? "checkbox" : "radio",
                name: q.id,
                readOnly: true,
              }),
              " ",
              opt.label || opt.id
            );
          })
        );
      })
    );
  }

  var components = {
    Callout: Callout,
    DataModel: DataModel,
    Endpoint: Endpoint,
    Mermaid: Mermaid,
    Diagram: Diagram,
    FileTree: FileTree,
    AnnotatedCode: AnnotatedCode,
    Diff: Diff,
    Checklist: Checklist,
    QuestionForm: QuestionForm,
  };

  function renderMdxInto(container, source) {
    return V.compile(stripFrontmatter(source), {
      outputFormat: "function-body",
      development: false,
      jsx: false,
    })
      .then(function (compiled) {
        // run() evaluates the compiled body with new AsyncFunction, which is why a frame
        // rendering MDX is assembled with 'unsafe-eval' in its CSP. baseUrl is only used
        // for resolving imports; MDX documents in a share have none.
        return V.run(String(compiled), Object.assign({}, V.jsxRuntime, { baseUrl: location.href }));
      })
      .then(function (mod) {
        if (container.__agentGateMdxRoot) container.__agentGateMdxRoot.unmount();
        container.innerHTML = "";
        var root = V.createRoot(container);
        container.__agentGateMdxRoot = root;
        root.render(React.createElement(mod.default, { components: components }));
        return new Promise(function (resolve) {
          requestAnimationFrame(function () {
            requestAnimationFrame(resolve);
          });
        });
      });
  }

  window.AgentGateMDX = { renderMdxInto: renderMdxInto, components: components };
})();
