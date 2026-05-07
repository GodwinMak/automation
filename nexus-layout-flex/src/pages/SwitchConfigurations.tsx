import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Download } from "lucide-react";
import { ReusableTable } from "@/components/Table";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { PRODUCTION_URL } from "@/utils/Api";

type SwitchConfigRow = {
  id: string;
  deviceId: string;
  deviceName: string;
  ip: string;
  filePath?: string;
  updatedAt?: string;
  createdAt?: string;
};

const formatTimestamp = (value?: string) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
};

const SwitchConfigurations = () => {
  const [configs, setConfigs] = useState<SwitchConfigRow[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    const fetchConfigs = async () => {
      setLoading(true);
      try {
        const res = await axios.get(
          `${PRODUCTION_URL}/switch-configurations?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}`,
        );
        setConfigs(res.data.items || []);
        setTotalPages(res.data.totalPages || 1);
      } catch (error) {
        console.error("Error fetching switch configurations:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchConfigs();
  }, [page, pageSize, search]);

  const columns = useMemo(
    () => [
      { key: "deviceName", label: "Device" },
      { key: "ip", label: "IP" },
      {
        key: "updatedAt",
        label: "Last Updated",
        render: (item: SwitchConfigRow) => formatTimestamp(item.updatedAt),
      },
    ],
    [],
  );

  const handleDownload = (config: SwitchConfigRow) => {
    const url = `${PRODUCTION_URL}/switch-configurations/${config.id}/download`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const Action = (config: SwitchConfigRow) => (
    <>
      <DropdownMenuItem className="gap-2" onClick={() => handleDownload(config)}>
        <Download className="h-4 w-4" /> Download
      </DropdownMenuItem>
    </>
  );

  return (
    <div className="p-6">
      <ReusableTable
        title="Switch Configurations"
        description="Search by device name or IP and download the latest configuration file."
        columns={columns}
        data={configs}
        actions={Action}
        loading={loading}
        headerActions={
          <Input
            placeholder="Search device or IP..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-64"
          />
        }
        pagination={{
          page,
          totalPages,
          onPageChange: (newPage) => setPage(newPage),
          pageSize,
          onPageSizeChange: (newSize) => {
            setPageSize(newSize);
            setPage(1);
          },
        }}
      />
    </div>
  );
};

export default SwitchConfigurations;
