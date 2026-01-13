import { Hook } from "require-in-the-middle";

import { wrapEnvironmentClass } from "./wrapper";

// Hook Jest’s environments without editing jest.config.js
// We intercept the modules that Jest loads for its environment and return our wrapped class.
function wrapEnvironmentExports(origExports: any) {
  try {
    // CJS class export: module.exports = class TestEnvironment { ... }
    if (typeof origExports === "function") {
      return wrapEnvironmentClass(origExports);
    }

    // Named/default exports object
    if (origExports && typeof origExports === "object") {
      const out = Object.create(origExports);
      if (typeof origExports.default === "function") {
        out.default = wrapEnvironmentClass(origExports.default);
      }
      if (typeof origExports.TestEnvironment === "function") {
        out.TestEnvironment = wrapEnvironmentClass(origExports.TestEnvironment);
      }
      return out;
    }
  } catch {
    // fall through to original if wrapping fails
  }
  return origExports;
}

// Install hooks for both Node and JSDOM environments
new Hook(["jest-environment-node", "jest-environment-jsdom"], (exports) => {
  return wrapEnvironmentExports(exports);
});
