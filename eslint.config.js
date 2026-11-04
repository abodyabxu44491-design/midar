/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Code checks (npm run lint). The server, scripts and tests run on Node; the pages run in the browser; the service
// worker has its own globals. Third-party files in public/shared/vendor are not ours to change, so they are skipped.
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/**", "public/shared/vendor/**", "coverage/**", "playwright-report/**", "test-results/**"] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: "module" },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none", ignoreRestSiblings: true }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": ["error", { destructuring: "all", ignoreReadBeforeAssign: true }],
      "no-implicit-globals": "error",
      "no-shadow-restricted-names": "error",
      "no-throw-literal": "error",
      "no-self-compare": "error",
      "no-template-curly-in-string": "error",
      "no-unreachable-loop": "error",
      // Regexes over Arabic text escape brackets and dashes for readability; the escapes change nothing.
      "no-useless-escape": "off",
      // Arabic text legitimately carries non-breaking spaces and joiners inside strings and patterns.
      "no-irregular-whitespace": ["error", { skipStrings: true, skipComments: true, skipRegExps: true, skipTemplates: true }],
    },
  },
  { files: ["src/**/*.js", "scripts/**/*.js", "tests/**/*.js", "*.js", "*.mjs"], languageOptions: { globals: { ...globals.node } } },
  { files: ["public/**/*.js"], languageOptions: { globals: { ...globals.browser } } },
  { files: ["public/sw.js"], languageOptions: { globals: { ...globals.serviceworker } } },
  // Runs first in very old browsers to decide whether the app can load at all, so it stays plain ES5.
  { files: ["public/shared/js/compat.js"], rules: { "no-var": "off", "prefer-const": "off", "no-useless-assignment": "off" } },
];
