import { Init1792886400000 } from './1792886400000-Init';
import { ProtectOutbox1792972800000 } from './1792972800000-ProtectOutbox';

/**
 * Every migration, oldest first. Migrations are append-only: never edit one that has been
 * applied; add a new file (npm run db:migration:create) and list it here and in checksums.json.
 */
export const MIGRATIONS = [Init1792886400000, ProtectOutbox1792972800000];
