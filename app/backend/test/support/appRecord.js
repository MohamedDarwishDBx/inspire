// The platform's App record always names the App's own service principal (service_principal_client_id and service_principal_name).
// A fake that serves an App record without them would make Inspire refuse the App's reads with a 409, which is only the right
// answer for an App that truly has no service principal. Fixtures that want that case set the id to '' explicitly.
const DEFAULT_APP_SP = { client_id: 'app-sp-default', name: 'app-sp' };

function withServicePrincipal(record) {
  if (!record || typeof record !== 'object' || 'service_principal_client_id' in record) return record;
  return { ...record, service_principal_client_id: DEFAULT_APP_SP.client_id, service_principal_name: DEFAULT_APP_SP.name };
}

module.exports = { DEFAULT_APP_SP, withServicePrincipal };
