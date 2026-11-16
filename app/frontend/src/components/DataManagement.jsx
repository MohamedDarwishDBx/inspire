import DataFilters from './DataFilters';

// Data Management (REQ-361): two sections in order. Relationships first (how the picked tables join), then the Data filter.
export default function DataManagement(props) {
  return (
    <div data-data-management className="space-y-6">
      <section aria-labelledby="data-management-relationships" data-section="relationships" className="space-y-2">
        <h3 id="data-management-relationships" className="text-sm font-bold text-text-primary">Relationships</h3>
        <p className="text-text-secondary">How the tables you picked join. Relationships are found from the picked tables.</p>
      </section>
      <section aria-labelledby="data-management-filter" data-section="data-filter" className="space-y-2">
        <h3 id="data-management-filter" className="text-sm font-bold text-text-primary">Data filter</h3>
        <DataFilters {...props} />
      </section>
    </div>
  );
}
