import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentCapacity: number;
}

export const UpgradeModal = ({ open, onOpenChange, currentCapacity }: UpgradeModalProps) => {
  const [action, setAction] = useState<"upgrade" | "downgrade">("upgrade");
  const [newCapacity, setNewCapacity] = useState("");

  const handleSubmit = () => {
    if (!newCapacity) {
      toast({
        title: "Error",
        description: "Please enter a new capacity value",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: `${action === "upgrade" ? "Upgrade" : "Downgrade"} Request Submitted`,
      description: `Capacity change from ${currentCapacity} Mbps to ${newCapacity} Mbps has been requested.`,
    });

    onOpenChange(false);
    setNewCapacity("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Upgrade/Downgrade Capacity</DialogTitle>
          <DialogDescription>
            Modify the network capacity for this customer connection.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="action">Action</Label>
            <Select
              value={action}
              onValueChange={(value: "upgrade" | "downgrade") => setAction(value)}
            >
              <SelectTrigger id="action">
                <SelectValue placeholder="Select action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="upgrade">Upgrade</SelectItem>
                <SelectItem value="downgrade">Downgrade</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="current">Current Capacity</Label>
            <Input id="current" value={`${currentCapacity} Mbps`} disabled />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new">New Capacity (Mbps)</Label>
            <Input
              id="new"
              type="number"
              placeholder="Enter new capacity"
              value={newCapacity}
              onChange={(e) => setNewCapacity(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>Submit Request</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
