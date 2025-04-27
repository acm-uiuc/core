import { defineConfig, globalIgnores } from "eslint/config";
import _import from "eslint-plugin-import";
import prettier from "eslint-plugin-prettier";
import { fixupPluginRules } from "@eslint/compat";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";
import mantine from "eslint-config-mantine";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default defineConfig([
  globalIgnores(["**/*.d.ts", "**/vite.config.ts"]),
  {
    extends: [
      ...compat.extends(
        "plugin:prettier/recommended",
        "plugin:@typescript-eslint/recommended",
      ),
      ...mantine,
    ],

    plugins: { import: fixupPluginRules(_import), prettier },

    settings: {
      "import/parsers": {
        "@typescript-eslint/parser": [".ts", ".tsx", ".js", ".jsx"],
      },
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: ["src/api/tsconfig.json", "src/ui/tsconfig.json"],
        },
      },
    },

    rules: {
      "import/no-unresolved": "error",
      "no-param-reassign": "off",
      "import/extensions": [
        "error",
        "ignorePackages",
        { js: "never", jsx: "never", ts: "never", tsx: "never" },
      ],
      "no-unused-vars": "off",
      "max-classes-per-file": "off",
      "func-names": "off",
      "no-case-declarations": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-module-boundary-types": "off",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.testdata.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    files: ["src/ui/*", "src/ui/**/*"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
]);
