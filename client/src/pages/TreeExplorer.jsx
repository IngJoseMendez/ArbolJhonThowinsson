import { api } from '../api.js';
import TreeExplorerView from '../components/TreeExplorerView.jsx';
import { ErrorBox, Loading, useAsync } from '../components/ui.jsx';
import { useQueryState } from '../lib/useParams.js';
import { useIsPhone } from '../lib/device.js';

export default function TreeExplorer() {
  const [params, setParams] = useQueryState();
  const phone = useIsPhone();
  const { data: heads, loading, error } = useAsync(() => api.get('/heads'), []);
  if (loading) return <Loading />;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  const active = heads.filter((h) => h.status === 'active');
  return (
    <div className="page-full">
      <TreeExplorerView heads={active} params={params} setParams={setParams} compact={phone} />
    </div>
  );
}
