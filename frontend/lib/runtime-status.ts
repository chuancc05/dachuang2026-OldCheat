import { getRagRuntimeStatus } from "@/lib/rag"

type AiProvider = "auto" | "deepseek" | "ollama"
type AiSource = "deepseek" | "ollama" | "fallback"

export type RuntimeStatus = {
  checkedAt: string
  overall: "ready" | "degraded"
  ai: {
    configuredProvider: AiProvider
    preferredSource: AiSource
    fallbackReady: boolean
  }
  rag: ReturnType<typeof getRagRuntimeStatus>
  voice: {
    mode: "gateway" | "browser-fallback"
    browserFallbackReady: boolean
    textFallbackReady: boolean
  }
}

function envValue(key: string): string {
  return (process.env[key] ?? "").trim()
}

function hasDeepSeekKey(): boolean {
  return Boolean(envValue("DEEPSEEK_API_KEY") || envValue("DEEPSEEK_API_KEY_B64"))
}

function normalizeAiProvider(value: string): AiProvider {
  const normalized = value.toLowerCase()
  return normalized === "deepseek" || normalized === "ollama" ? normalized : "auto"
}

function isHostedDeployment(): boolean {
  return Boolean(envValue("NETLIFY") || envValue("CONTEXT"))
}

function isLoopbackUrl(value: string): boolean {
  return /(?:127\.0\.0\.1|localhost|::1)/iu.test(value)
}

function preferredAiSource(provider: AiProvider): AiSource {
  if (provider === "deepseek" || (provider === "auto" && hasDeepSeekKey())) {
    return hasDeepSeekKey() ? "deepseek" : "fallback"
  }

  const ollamaIsCloudReachable = !isHostedDeployment() || !isLoopbackUrl(envValue("OLLAMA_URL") || "http://127.0.0.1:11434")
  return ollamaIsCloudReachable ? "ollama" : "fallback"
}

function voiceMode(): "gateway" | "browser-fallback" {
  const gatewayUrl = envValue("NEXT_PUBLIC_VOICE_GATEWAY_URL")
  return gatewayUrl.startsWith("wss://") && !isLoopbackUrl(gatewayUrl) ? "gateway" : "browser-fallback"
}

/**
 * Reports deployment readiness only. It never calls a model and never returns
 * credentials, so opening the status panel has no token or API-key exposure.
 */
export function getRuntimeStatus(): RuntimeStatus {
  const configuredProvider = normalizeAiProvider(envValue("AI_PROVIDER"))
  const preferredSource = preferredAiSource(configuredProvider)
  const rag = getRagRuntimeStatus()
  const voice = voiceMode()

  return {
    checkedAt: new Date().toISOString(),
    overall: preferredSource === "fallback" || (rag.enabled && rag.mode === "lexical") ? "degraded" : "ready",
    ai: {
      configuredProvider,
      preferredSource,
      fallbackReady: true,
    },
    rag,
    voice: {
      mode: voice,
      browserFallbackReady: true,
      textFallbackReady: true,
    },
  }
}
