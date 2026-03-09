import tseslint from "typescript-eslint";
import security from "eslint-plugin-security";

export default [
  {
    ignores: [
      "node_modules/",
      ".output/",
      ".wxt/",
      "dist/",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    plugins: { security },
    rules: {
      ...security.configs.recommended.rules,
    },
  },
];
