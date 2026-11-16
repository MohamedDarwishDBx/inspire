import { useMemo } from 'react';
import DataFilters from './DataFilters';
import RelationshipsSection from './RelationshipsSection';
import { pickedTableNames } from '../lib/tableScope';

// Data Management (REQ-361): two sections in order. Relationships first (how the picked tables join), then the Data filter.
export default function DataManagement({ scope, scopes, relationships, onRelationships, apiFetch, warehouseId, ...rest }) {
  const tables = useMemo(() => pickedTableNames(scopes, scope), [scopes, scope]);
  return (
    <div data-data-management className="space-y-6">
      <section aria-labelledby="data-management-relationships" data-section="relationships" className="space-y-2">
        <h3 id="data-management-relationships" className="text-sm font-bold text-text-primary">Relationships</h3>
        <p className="text-text-secondary">How the tables you picked join. Inspire suggests them from declared keys, then from matching column names.</p>
        <RelationshipsSection tables={tables} relationships={relationships} onRelationships={onRelationships} apiFetch={apiFetch} warehouseId={warehouseId} />
      </section>
      <section aria-labelledby="data-management-filter" data-section="data-filter" className="space-y-2">
        <h3 id="data-management-filter" className="text-sm font-bold text-text-primary">Data filter</h3>
        <DataFilters scope={scope} scopes={scopes} apiFetch={apiFetch} warehouseId={warehouseId} {...rest} />
      </section>
    </div>
  );
}
