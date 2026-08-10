/**
 * Netherlands Country Pack adapter for Tax Integration (DEV-098).
 *
 * Thin bridge — does not modify the Netherlands Tax Pack.
 */

import { netherlandsTaxPackService } from "@/features/tax-packs/netherlands";
import {
  NL_JURISDICTION_ID,
  NL_PACK_ID,
} from "@/features/tax-packs/netherlands/constants/ids";
import type { TaxCountryPackAdapter } from "../registry/country-pack-registry";

export const netherlandsTaxCountryPackAdapter: TaxCountryPackAdapter = {
  country_codes: ["NL", "NLD"],
  pack_id: NL_PACK_ID,
  default_jurisdiction_id: NL_JURISDICTION_ID,
  category_codes: [
    "goods",
    "services",
    "digital_services",
    "food",
    "alcohol",
    "transport",
  ],
  buildContext(input) {
    return netherlandsTaxPackService.buildTaxContext({
      occurredAt: input.occurredAt,
      jurisdictionId: input.jurisdictionId ?? undefined,
      includeInactive: input.includeInactive,
    });
  },
};
