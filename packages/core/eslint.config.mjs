// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
      // Several real-backend classes (OpenAIEmbeddingsClient,
      // ChatOpenAIAnswerClient) lazily `require()` their SDK so it's only
      // loaded when actually instantiated -- tests never import it.
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
