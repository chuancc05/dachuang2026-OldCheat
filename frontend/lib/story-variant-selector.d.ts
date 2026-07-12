import type { StoryVariant } from "./story-variants"
import type { Scenario } from "./scenarios"

export function selectStoryVariant(
  variants: StoryVariant[],
  scenarioCode: string,
  recentIds?: string[],
  random?: () => number,
  priorityIds?: string[],
): StoryVariant | null

export function applyStoryVariant(scenario: Scenario, variant: StoryVariant): Scenario
