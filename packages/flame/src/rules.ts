/**
 * The rules file (ember#309): one document per project, the same for every
 * visitor, that flame picks a new visitor's arms from on the device (flame#24).
 * It holds nothing about any visitor. The `$assignment` record step checks
 * each pick against what only ember stores, and refuses one that disagrees.
 */
import type { StoredAssignment, Variant } from './types';
import { selectVariantDeterministically } from './bucketing';
import { isHeldOut } from './holdout';

/** The wire version flame reads. A file of any other version is not used. */
export const RULES_FILE_VERSION = 1;

/** An arm of a running experiment. */
export interface RulesVariant {
  id: string;
  name: string;
  /** What a client not ready to pick shows. */
  is_control: boolean;
  /** The pick's weight. ember publishes a negative weight as 0. */
  weight: number;
}

/** A running experiment, with what a local pick reads. */
export interface RulesExperiment {
  id: string;
  slug: string;
  /** The pages it runs on (flame#50). `null`: every page. */
  url_pattern: string | null;
  /** Sorted by id, the order the pick walks them in. */
  variants: RulesVariant[];
}

/** The project's Holdout (ember ADR 0024). */
export interface RulesHoldout {
  id: string;
  /** Share of new visitors held out, in percent. */
  percentage: number;
  /** Whether it admits anyone. An inactive Holdout holds nobody out. */
  active: boolean;
}

/** A promoted winner, served to every visitor the Holdout does not hold out (ember ADR 0039). */
export interface RulesPromoted {
  id: string;
  slug: string;
  url_pattern: string | null;
  winner_promoted_at: string;
  winner: RulesVariant;
}

/** A project's rules file, version {@link RULES_FILE_VERSION}. */
export interface RulesFile {
  version: number;
  experiments: RulesExperiment[];
  holdout: RulesHoldout | null;
  promoted: RulesPromoted[];
}

/** One experiment's answer for this visitor: what a read of it returns. */
export interface Arm {
  experimentId: string;
  slug: string;
  /** The pages it runs on. `null`: every page. */
  urlPattern: string | null;
  /** The variant a read returns. */
  variant: Variant;
  /** The experiment's control, which a read off its pages returns. */
  control: Variant | null;
  /**
   * A real arm of a running experiment: its first read records it, and events
   * carry it from then on. False for control given to a Holdout member and for
   * a promoted winner, which are never recorded.
   */
  exposure: boolean;
}

function toVariant(experimentId: string, variant: RulesVariant): Variant {
  return {
    id: variant.id,
    experiment_id: experimentId,
    name: variant.name,
    is_control: variant.is_control,
    weight: variant.weight,
  };
}

/**
 * Every arm this visitor gets from the rules file. For each running
 * experiment: the arm saved for this visitor, else control for a Holdout
 * member, else ember's pick. Each promoted winner, unless held out.
 *
 * Only a visitor with no saved arm is drawn for the Holdout: a saved arm was
 * recorded, so ember stored them as outside it, and its stored arm wins.
 */
export async function pickArms(
  rules: RulesFile,
  userId: string,
  saved: Record<string, StoredAssignment>
): Promise<Arm[]> {
  const mine = (id: string) => (saved[id]?.userId === userId ? saved[id] : undefined);
  const holdout = rules.holdout;
  const heldOut =
    !!holdout?.active &&
    !Object.keys(saved).some(mine) &&
    (await isHeldOut(userId, holdout.id, holdout.percentage));

  const arms: Arm[] = [];
  for (const experiment of rules.experiments) {
    const control = experiment.variants.find((v) => v.is_control);
    const stored = experiment.variants.find((v) => v.id === mine(experiment.id)?.variantId);
    const picked =
      stored ??
      (heldOut
        ? control
        : await selectVariantDeterministically(userId, experiment.id, experiment.variants));
    if (!picked) continue;
    arms.push({
      experimentId: experiment.id,
      slug: experiment.slug,
      urlPattern: experiment.url_pattern,
      variant: toVariant(experiment.id, picked),
      control: control ? toVariant(experiment.id, control) : null,
      exposure: !heldOut,
    });
  }
  if (heldOut) return arms;
  for (const promoted of rules.promoted) {
    arms.push({
      experimentId: promoted.id,
      slug: promoted.slug,
      urlPattern: promoted.url_pattern,
      variant: toVariant(promoted.id, promoted.winner),
      control: null,
      exposure: false,
    });
  }
  return arms;
}

/**
 * A fetched or stored rules file, if flame can read it: version
 * {@link RULES_FILE_VERSION}, with its lists. Anything else is no rules file.
 */
export function parseRules(data: unknown): RulesFile | null {
  const rules = data as Partial<RulesFile> | null;
  if (
    rules?.version !== RULES_FILE_VERSION ||
    !Array.isArray(rules.experiments) ||
    !Array.isArray(rules.promoted)
  ) {
    return null;
  }
  return { ...rules, holdout: rules.holdout ?? null } as RulesFile;
}

/** One stored copy per project, so two projects on one site never mix. */
const rulesKey = (apiKey: string) => `flame_rules_${apiKey}`;

/** The rules file stored on an earlier load, if any. */
export function loadStoredRules(apiKey: string): RulesFile | null {
  try {
    const stored = localStorage.getItem(rulesKey(apiKey));
    return stored ? parseRules(JSON.parse(stored)) : null;
  } catch {
    return null;
  }
}

/** Keep this rules file for the next load. */
export function storeRules(apiKey: string, rules: RulesFile): void {
  try {
    localStorage.setItem(rulesKey(apiKey), JSON.stringify(rules));
  } catch {
    // No storage: the next load fetches before it can pick.
  }
}

/** Delete the stored copy. Consent withdrawal (flame#18) leaves only the refusal. */
export function clearStoredRules(apiKey: string): void {
  try {
    localStorage.removeItem(rulesKey(apiKey));
  } catch {
    // No storage: nothing was stored.
  }
}
