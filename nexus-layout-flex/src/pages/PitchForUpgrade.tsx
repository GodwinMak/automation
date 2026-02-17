import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { ReusableTable } from '@/components/Table';
import { useNavigate } from 'react-router-dom';
import { PRODUCTION_URL } from '@/utils/Api';

const PitchForUpgrade = () => {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const navigate = useNavigate();

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${PRODUCTION_URL}/pitch-for-upgrade`);
      setRows(res.data || []);
    } catch (err) {
      console.error('Error fetching pitch data', err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const runNow = async () => {
    setLoading(true);
    try {
      await axios.post(`${PRODUCTION_URL}/pitch-for-upgrade/run`);
      await fetchData();
      alert('Pitch check executed');
    } catch (err: any) {
      const msg = err?.response?.data?.message || err.message || 'Run failed';
      alert(`Run failed: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  // Deduplicate by CID or customerName
  const uniqueRowsMap = new Map<string, any>();
  for (const row of rows) {
    const key = row.cid || row.customerName;
    if (!uniqueRowsMap.has(key)) {
      uniqueRowsMap.set(key, row);
    }
  }

  const uniqueRows = Array.from(uniqueRowsMap.values());
  const totalPages = Math.max(1, Math.ceil(uniqueRows.length / pageSize));
  const pagedData = uniqueRows.slice(
    (page - 1) * pageSize,
    page * pageSize
  );

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Pitch For Upgrade</h1>
        <div className="flex gap-2">
          <Button onClick={fetchData} disabled={loading}>
            Refresh
          </Button>
          <Button onClick={runNow} disabled={loading}>
            Run Now
          </Button>
        </div>
      </div>

      <ReusableTable
        title="Pitch For Upgrade"
        description="Customers with sustained high usage (last 24h)"
        data={pagedData}
        loading={loading}
        columns={[
          {
            key: 'runAt',
            label: 'Run At',
            render: (r) => new Date(r.runAt).toLocaleString(),
          },
          {
            key: 'customerName',
            label: 'Customer',
            render: (row) => (
              <button
                type="button"
                className="text-primary hover:underline text-left"
                onClick={() =>
                  navigate('/viewcustomer', {
                    state: {
                      fromPitch: true,
                      interface: row.interfaceName,
                    },
                  })
                }
              >
                {row.customerName}
              </button>
            ),
          },
          { key: 'interfaceName', label: 'Interface' },
          { key: 'upmbps', label: 'Up Mbps', render: (r) => r.upmbps ?? '-' },
          { key: 'downmbps', label: 'Down Mbps', render: (r) => r.downmbps ?? '-' },
          {
            key: 'pctOver95Upload',
            label: '% Over 95 Up',
            render: (r) =>
              r.pctOver95Upload !== undefined ? `${r.pctOver95Upload}%` : '-',
          },
          {
            key: 'pctOver95Download',
            label: '% Over 95 Down',
            render: (r) =>
              r.pctOver95Download !== undefined ? `${r.pctOver95Download}%` : '-',
          },
          { key: 'cid', label: 'CID' },
          { key: 'nbr', label: 'NBR' },
        ]}
        pagination={{
          page,
          totalPages,
          onPageChange: setPage,
          pageSize,
          onPageSizeChange: (s) => {
            setPageSize(s);
            setPage(1);
          },
        }}
      />
    </div>
  );
};

export default PitchForUpgrade;
