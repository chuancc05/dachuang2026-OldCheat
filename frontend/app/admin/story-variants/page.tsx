import scenarioLibrary from "@/data/scenario_library.json"
import { StoryVariantManager } from "@/components/admin/story-variant-manager"

export const dynamic = "force-dynamic"
export default function StoryVariantAdminPage() {
  return <StoryVariantManager scenarios={scenarioLibrary.scenes.map((scene) => ({ code: scene.id, title: scene.name }))} />
}
