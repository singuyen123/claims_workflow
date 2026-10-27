import { EntitySchema } from 'typeorm';

export type FaultRow = { id: number; remaining_failures: number };

export const FaultEntity = new EntitySchema<FaultRow>({
  name: 'MockGatewayFault',
  tableName: 'mock_gateway_faults',
  columns: {
    id: { type: 'smallint', primary: true },
    remaining_failures: { type: 'integer', default: 0 },
  },
});
