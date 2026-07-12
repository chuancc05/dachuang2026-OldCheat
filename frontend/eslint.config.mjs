import path from "node:path"
import { fileURLToPath } from "node:url"
import { FlatCompat } from "@eslint/eslintrc"

const root = path.dirname(fileURLToPath(import.meta.url))
const compat = new FlatCompat({ baseDirectory: root })

const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".next/**",
      ".data/**",
      "node_modules/**",
      "next-env.d.ts",
      "data/rag-index.json",
      "voice-gateway/public/audio/**",
    ],
  },
]

export default config
