import React, { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { PRODUCTION_URL as API_URL } from "@/utils/Api";
import { useAuthContext } from "@/hooks/useAuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Waypoints, Plus, Eye, Pencil, Trash2, Loader2 } from "lucide-react";

type MapSummary = {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
  createdByName: string;
  nodeCount: number;
  linkCount: number;
};

const NetworkMaps = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAuthContext();
  const { toast } = useToast();
  const canManage = hasPermission("canManageNetworkMaps");

  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<MapSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchMaps = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/network-maps`);
      setMaps(res.data.maps || []);
    } catch (err) {
      console.error("Error fetching network maps:", err);
      toast({ title: "Failed to load network maps", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMaps();
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await axios.post(`${API_URL}/network-maps`, {
        name: newName.trim(),
        description: newDescription.trim() || null,
      });
      setCreateOpen(false);
      setNewName("");
      setNewDescription("");
      navigate(`/network-maps/${res.data.id}/edit`);
    } catch (err) {
      console.error("Error creating network map:", err);
      toast({ title: "Failed to create map", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await axios.delete(`${API_URL}/network-maps/${deleteTarget.id}`);
      setDeleteTarget(null);
      fetchMaps();
      toast({ title: `"${deleteTarget.name}" deleted` });
    } catch (err) {
      console.error("Error deleting network map:", err);
      toast({ title: "Failed to delete map", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Network Maps</h1>
          <p className="text-sm text-muted-foreground">
            Hand-curated network diagrams with live link status, capacity, and traffic.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Map
          </Button>
        )}
      </div>

      {loading && (
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading maps...
        </div>
      )}

      {!loading && maps.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Waypoints className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {canManage
                ? "No maps yet — create one to get started."
                : "No maps have been created yet."}
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && maps.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {maps.map((map) => (
            <Card key={map.id} className="flex flex-col">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Waypoints className="h-4 w-4 text-primary" />
                  {map.name}
                </CardTitle>
                {map.description && (
                  <CardDescription className="line-clamp-2">{map.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent className="mt-auto space-y-3">
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>{map.nodeCount} nodes</span>
                  <span>{map.linkCount} links</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Updated {new Date(map.updatedAt).toLocaleString()} by {map.createdByName}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() =>
                      window.open(`${window.location.origin}/network-maps/${map.id}`, "_blank", "noopener,noreferrer")
                    }
                  >
                    <Eye className="mr-2 h-4 w-4" />
                    View
                  </Button>
                  {canManage && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/network-maps/${map.id}/edit`)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(map)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Network Map</DialogTitle>
            <DialogDescription>
              Give it a name, then place devices and draw links in the editor.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="map-name">Name</Label>
              <Input
                id="map-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Backbone Overview"
              />
            </div>
            <div>
              <Label htmlFor="map-description">Description (optional)</Label>
              <Textarea
                id="map-description"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="What this map is for"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create & Edit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Map</DialogTitle>
            <DialogDescription>
              Delete "{deleteTarget?.name}"? This removes all its saved nodes and links. This
              can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete Map
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default NetworkMaps;
