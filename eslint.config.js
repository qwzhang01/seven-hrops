export default [
  {
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/services/*"],
              message: "组件层不得直接 import services；请通过 store action 编排业务能力。",
            },
          ],
        },
      ],
    },
  },
]
