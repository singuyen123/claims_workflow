import type { ClaimQueryService } from './claim-query-service';
import type { ClaimService } from './claim-service';
import type { OperationsService } from './operations-service';
import type { WorkflowService } from './workflow-service';

/** What controllers use: they call these, never the database. */
export interface Services {
  claims: ClaimService;
  queries: ClaimQueryService;
  workflows: WorkflowService;
  operations: OperationsService;
}
