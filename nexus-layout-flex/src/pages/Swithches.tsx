import React, { useState, useEffect, useContext } from "react";
import axios from "axios";
import { ReusableTable } from "@/components/Table";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Eye } from "lucide-react";
import { useAuthContext } from "@/hooks/useAuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { PRODUCTION_URL } from "@/utils/Api";


function Switches({ onOpen }) {
  const [devices, setDevices] = useState([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [pageSize, setPageSize] = useState(5);

  const { state: authState } = useAuthContext();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [actionType, setActionType] = useState(null); // 'open' or 'fetch'

  useEffect(() => {
    const fetchDevices = async () => {
      setLoading(true);
      try {
        const res = await axios.get(
          `${PRODUCTION_URL}/devices?page=${page}&pageSize=${pageSize}&search=${search}`
        );
        setDevices(res.data.devices || []);
        setTotalPages(res.data.totalPages);
      } catch (err) {
        console.error("Error fetching devices:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchDevices();
  }, [page, search, pageSize]);

  const handlePageSizeChange = (value) => {
    setPageSize(Number(value));
    setPage(1);
  };

  const handleOpenPrompt = (device) => {
    setSelectedDevice(device);
    setActionType('open');
    setIsModalOpen(true);
  };

  const handleFetchPrompt = (device) => {
    setSelectedDevice(device);
    setActionType('fetch');
    setIsModalOpen(true);
  };

  const handleModalSubmit = async (e) => {
  e.preventDefault();
  if (!password) {
    alert("Password is required.");
    return;
  }
  
  if (actionType === 'open') {
    // You are trying to pass the username from the auth context
    // It should be authState?.userData?.username, not .email
    const username = authState?.userData?.username;

    // Make sure username is not null or undefined
    if (!username) {
        alert("Username not found in authentication context. Please log in again.");
        return;
    }

    onOpen({ 
      deviceId: selectedDevice.id, 
      password, 
      username, // Pass the username here
    });
  } else if (actionType === 'fetch') {
    // The fetchInterfacesUp function needs to be updated to handle this change
    await fetchInterfacesUp(selectedDevice.id, password);
  }

  setIsModalOpen(false);
  setPassword("");
};

  const fetchInterfacesUp = async (deviceId, password) => {
    setLoading(true);
    try {
      const res = await axios.post(
        "http://localhost:4000/devices/interfaces-up",
        {
          deviceId,
          password,
          email: authState?.userData?.email
        }
      );
      console.log("UP Interfaces:", res.data);
      alert("Check console for UP interfaces JSON");
    } catch (err) {
      console.error("Error fetching interfaces:", err);
      alert("Error fetching interfaces: " + (err.response?.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    { key: "name", label: "Name" },
    { key: "ip", label: "IP" },
  ];

  const Action = (device) => (
    <>
      <DropdownMenuItem className="gap-2" onClick={() => handleOpenPrompt(device)}>
        <Eye className="h-4 w-4" /> Open
      </DropdownMenuItem>

      {(device.name === "LTZ-BNG02-TIG-DAR" ||
        device.name === "LTZ-BNG02-RAH-DAR") && (
        <DropdownMenuItem className="gap-2" onClick={() => handleFetchPrompt(device)}>
          Fetch Interfaces
        </DropdownMenuItem>
      )}
    </>
  );

  return (
    <div className="p-6">
      <ReusableTable
        title="Devices"
        description="Manage and connect to available devices"
        columns={columns}
        data={devices}
        actions={Action}
        loading={loading}
        headerActions={
          <input
            type="text"
            placeholder="Search device..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 text-black"
          />
        }
        pagination={{
          page,
          totalPages,
          onPageChange: (newPage) => setPage(newPage),
          pageSize,
          onPageSizeChange: handlePageSizeChange,
        }}
      />
      
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter Password for SSH</DialogTitle>
            <DialogDescription>
              Please enter the password to connect to **{selectedDevice?.name}**.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleModalSubmit}>
            <div className="py-4">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit">Connect</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default Switches;