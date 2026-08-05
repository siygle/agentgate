// Bundle entry for web/static/vendor/mdx-runtime.bundle.js.
//
// This exposes ONLY third-party code, matching every other file in web/static/vendor.
// AgentGate's own MDX components and rendering glue deliberately stay outside the
// bundle, as plain editable JS in web/static/renderers/doc/mdx-components.js — so
// changing a component does not require re-running this build.
import React from "react";
import { createRoot } from "react-dom/client";
import { compile, run } from "@mdx-js/mdx";
import * as jsxRuntime from "react/jsx-runtime";

globalThis.AgentGateMDXVendor = { React, createRoot, compile, run, jsxRuntime };
