import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";

interface RequestItem {
  id: number;
  fromId: number;
  fromUsername: string;
  createdAt: string;
}

interface FriendRequestsProps {
  requests: RequestItem[];
  onRespond: (requestId: number, accept: boolean) => Promise<void>;
}

const FriendRequests = ({ requests, onRespond }: FriendRequestsProps) => {
  if (!requests || requests.length === 0) return null;

  return (
    <div className="p-2 border-b border-border">
      <p className="text-sm font-medium mb-2">Friend Requests</p>
      <div className="space-y-2">
        {requests.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between gap-3 p-2 bg-card rounded"
          >
            <div className="flex items-center gap-3">
              <Avatar>
                <AvatarFallback className="bg-secondary">
                  {r.fromUsername?.charAt(0)?.toUpperCase() ?? "U"}
                </AvatarFallback>
              </Avatar>
              <div className="text-left">
                <p className="font-medium">{r.fromUsername}</p>
                <p className="text-xs text-muted-foreground">Requested</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  try {
                    await onRespond(r.id, false);
                    toast.success("Request rejected");
                  } catch (e) {
                    toast.error("Failed to reject");
                  }
                }}
              >
                Reject
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    await onRespond(r.id, true); // <-- pakai request.id
                    toast.success("Friend added");
                  } catch (e) {
                    toast.error("Failed to accept");
                  }
                }}
              >
                Accept
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FriendRequests;
