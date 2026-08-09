import type { DbClient } from '@polis/db';
import { operationalRoutes, type Route } from '@polis/service-runtime';
import { contributionApiRoutes, graphProposalRoutes } from './contribution-routes.js';
import { representativeRoutes } from './representative-routes.js';

/** Build the §19 contribution + review route table bound to a DB client. */
export function contributionRoutes(db: DbClient): Route[] {
  return [
    ...operationalRoutes('contribution-service'),
    ...contributionApiRoutes(db),
    ...representativeRoutes(db),
    ...graphProposalRoutes(db),
  ];
}
