import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LogOut, Send } from "lucide-react";
import { toast } from "sonner";
import io from "socket.io-client";
import FriendsList from "@/components/chat/FriendsList";
import ChatMessage from "@/components/chat/ChatMessage";
import AddFriendDialog from "@/components/chat/AddFriendDialog";
import FriendRequests from "@/components/chat/FriendRequests";

interface Message {
  id: number;
  senderId: number;
  content: string;
  timestamp: string;
}

interface Friend {
  id: number;
  username: string;
  online: boolean;
}

interface FriendRequest {
  id: number;
  fromId: number;
  fromUsername: string;
  createdAt: string;
}

const Chat = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesRef = useRef<Message[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const [newMessage, setNewMessage] = useState("");
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);
  const selectedFriendRef = useRef<number | null>(null);
  useEffect(() => {
    selectedFriendRef.current = selectedFriend?.id ?? null;
  }, [selectedFriend]);
  const [socket, setSocket] = useState<any>(null);
  const [user, setUser] = useState<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Helper to format incoming messages
  const formatMsg = (msg: any): Message => {
    const senderId = msg.sender_id ?? msg.senderId;
    const timestampRaw: string = msg.timestamp ?? new Date().toISOString();
    const timestamp =
      timestampRaw.indexOf(" ") !== -1
        ? new Date(timestampRaw.replace(" ", "T")).toISOString()
        : new Date(timestampRaw).toISOString();
    return {
      id: msg.id ?? Date.now(),
      senderId,
      content: msg.content,
      timestamp,
    };
  };

  useEffect(() => {
    const token = localStorage.getItem("token");
    const userData = localStorage.getItem("user");

    if (!token || !userData) {
      navigate("/");
      return;
    }

    // parse user once and reuse to avoid race with setUser
    const parsedUser = JSON.parse(userData);
    setUser(parsedUser);

    const newSocket = io("http://localhost:5000", {
      auth: { token },
      autoConnect: true,
    });

    setSocket(newSocket);

    // socket listeners
    const handleIncoming = (msg: any) => {
      const formatted = formatMsg(msg);
      const senderId = formatted.senderId;
      // support different field names from server
      const recipientId = msg.recipientId ?? msg.recipient_id ?? null;
      const currentFriendId = selectedFriendRef.current;
      // dedupe / replace optimistic
      const now = Date.now();
      const existing = messagesRef.current.findIndex((m) => {
        // match by same sender + same content + timestamp within 5s
        return (
          m.senderId === formatted.senderId &&
          m.content === formatted.content &&
          Math.abs(
            new Date(m.timestamp).getTime() -
              new Date(formatted.timestamp).getTime()
          ) < 5000
        );
      });

      if (existing !== -1) {
        // replace optimistic entry (or duplicate) with authoritative server message
        setMessages((prev) => {
          const copy = [...prev];
          copy[existing] = formatted;
          return copy;
        });
        return;
      }

      // append only if message relates to current conversation
      if (
        currentFriendId &&
        (senderId === currentFriendId || recipientId === currentFriendId)
      ) {
        setMessages((prev) => [...prev, formatted]);
      } else {
        // optional: update friends/notifications
      }
    };

    // --- NEW: friend request realtime handlers ---
    const handleIncomingRequest = (req: FriendRequest) => {
      // push new incoming request to list
      setFriendRequests((prev) => {
        // avoid duplicate
        if (prev.some((r) => r.id === req.id)) return prev;
        return [req, ...prev];
      });
    };

    // response from other user when they accept/reject (server should emit)
    const handleRequestResponse = (payload: any) => {
      // payload expected: { requestId, accepted: boolean, friend?: { id, username } }
      const { requestId, accepted, friend } = payload || {};
      // remove pending request if present
      setFriendRequests((prev) => prev.filter((r) => r.id !== requestId));
      if (accepted && friend) {
        setFriends((prev) => {
          // avoid duplicate
          if (prev.some((f) => f.id === friend.id)) return prev;
          return [friend, ...prev];
        });
      }
    };

    newSocket.on("connect_error", (err: any) => {
      console.warn("Socket connect_error", err);
    });

    newSocket.on("connect", () => {
      console.log("Socket connected", newSocket.id);

      // Inform server about the authenticated user so it can map socket id -> user id
      newSocket.emit("authenticate", parsedUser.id);
    });

    // --- NEW: update friends online status in realtime ---
    // initial list of online user ids (server should emit once after authenticate)
    const handleOnlineList = (onlineIds: (number | string)[]) => {
      const onlineNums = onlineIds.map((id) => Number(id));
      setFriends((prev) =>
        prev.map((f) => ({ ...f, online: onlineNums.includes(f.id) }))
      );
      setSelectedFriend((prev) =>
        prev ? { ...prev, online: onlineNums.includes(prev.id) } : prev
      );
    };

    // single user became online
    const handleUserOnline = (userId: number | string) => {
      const id = Number(userId);
      setFriends((prev) =>
        prev.map((f) => (f.id === id ? { ...f, online: true } : f))
      );
      setSelectedFriend((prev) =>
        prev?.id === id ? { ...prev, online: true } : prev
      );
    };

    // single user went offline
    const handleUserOffline = (userId: number | string) => {
      const id = Number(userId);
      setFriends((prev) =>
        prev.map((f) => (f.id === id ? { ...f, online: false } : f))
      );
      setSelectedFriend((prev) =>
        prev?.id === id ? { ...prev, online: false } : prev
      );
    };

    newSocket.on("onlineUsers", handleOnlineList);
    newSocket.on("userOnline", handleUserOnline);
    newSocket.on("userOffline", handleUserOffline);
    // --- END NEW ---

    // common event names (server may use different names - keep these as fallback)
    newSocket.on("message", handleIncoming);
    newSocket.on("privateMessage", handleIncoming);
    newSocket.on("newMessage", handleIncoming);

    // Load friends and restore last selected friend + messages
    (async () => {
      const loadedFriends = await fetchFriends();
      // fetch pending friend requests
      try {
        const token = localStorage.getItem("token");
        const res = await fetch("http://localhost:5000/api/friends/requests", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setFriendRequests(data || []);
        }
      } catch (err) {
        console.error("fetch requests error", err);
      }

      // restore last selected friend
      const lastFriendId = localStorage.getItem("lastFriendId");
      if (lastFriendId && loadedFriends) {
        const fid = Number(lastFriendId);
        const restored = loadedFriends.find((f: Friend) => f.id === fid);
        if (restored) {
          setSelectedFriend(restored);
          // fetch messages and compute alignment using parsedUser immediately
          await fetchMessages(restored.id, parsedUser.id);
        }
      }
    })();

    return () => {
      // cleanup listeners
      newSocket.off("friendRequest", handleIncomingRequest);
      newSocket.off("friendRequestResponse", handleRequestResponse);
      newSocket.off("message", handleIncoming);
      newSocket.off("privateMessage", handleIncoming);
      newSocket.off("newMessage", handleIncoming);

      // cleanup new listeners
      newSocket.off("onlineUsers", handleOnlineList);
      newSocket.off("userOnline", handleUserOnline);
      newSocket.off("userOffline", handleUserOffline);

      newSocket.disconnect();
      setSocket(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Return loaded friends (so caller can await)
  const fetchFriends = async (): Promise<Friend[] | null> => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch("http://localhost:5000/api/friends", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setFriends(data);
        return data;
      }
      return null;
    } catch (error) {
      console.error("Error fetching friends:", error);
      return null;
    }
  };

  // allow passing currentUserId to avoid relying on state that may not have updated yet
  const fetchMessages = async (friendId: number, currentUserId?: number) => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(
        `http://localhost:5000/api/messages/${friendId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (response.ok) {
        const data = await response.json();
        const formatted = data.map((msg: any) => ({
          id: msg.id ?? Date.now(),
          senderId: msg.sender_id ?? msg.senderId,
          content: msg.content,
          timestamp: new Date(
            (msg.timestamp ?? new Date().toISOString()).replace(" ", "T")
          ).toISOString(),
        }));
        setMessages(formatted);
        // Ensure alignment: if user state isn't set yet, you can rely on currentUserId passed above
        // ChatMessage uses user.id, but restoring user earlier avoids mismatch
      }
    } catch (error) {
      console.error("Error fetching messages:", error);
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedFriend || !socket || !user) return;

    const messageData = {
      recipientId: selectedFriend.id,
      content: newMessage,
      senderId: user.id,
    };

    // optimistic update so message appears instantly
    const optimistic: Message = {
      id: Date.now(),
      senderId: user.id,
      content: newMessage,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    // emit using common event name; keep same name used originally
    socket.emit("sendMessage", messageData, (ack: any) => {
      // optional acknowledgement handling
      if (ack && ack.error) {
        // rollback optimistic update if needed
        console.error("Send ack error:", ack);
        toast.error("Failed to send message");
        // could refetch messages or remove optimistic message
      }
    });

    setNewMessage("");

    console.log(
      "Sending message:",
      messageData,
      "Socket connected?",
      socket?.connected
    );
  };

  const handleSelectFriend = (friend: Friend) => {
    setSelectedFriend(friend);
    localStorage.setItem("lastFriendId", String(friend.id));
    // user should be available; if not, pass user.id when calling
    fetchMessages(friend.id, user?.id);
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("lastFriendId");
    if (socket) socket.close();
    toast.success("Logged out successfully");
    navigate("/");
  };

  // respondToRequest (accept/reject)
  const respondToRequest = async (requestId: number, accept: boolean) => {
    const token = localStorage.getItem("token");

    const endpoint = accept
      ? `http://localhost:5000/api/friends/accept/${requestId}`
      : `http://localhost:5000/api/friends/reject/${requestId}`;

    const res = await fetch(endpoint, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await res.json();
    console.log("RESPOND RESPONSE:", data, "STATUS:", res.status);

    if (!res.ok) throw new Error(data?.message || "Failed");

    // remove request dari UI
    setFriendRequests((prev) => prev.filter((r) => r.id !== requestId));

    // show distinct toast message
    if (!accept) {
        // toast.success("Request rejected"); // This is handled in the button onClick already, but good to know
    } else {
        // update friends list only if accepted
        fetchFriends();
    }
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <div
        className={`w-full md:w-80 border-r border-border bg-card flex-col ${
          selectedFriend ? "hidden md:flex" : "flex"
        }`}
      >
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Avatar>
              <AvatarFallback className="bg-primary text-primary-foreground">
                {user?.username?.charAt(0).toUpperCase() || "U"}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-semibold">{user?.username}</p>
              <p className="text-xs text-muted-foreground">Online</p>
            </div>
          </div>
          <div className="flex gap-2">
            <AddFriendDialog onFriendAdded={fetchFriends} />
            <Button variant="ghost" size="icon" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* NEW: render incoming friend requests */}
        <FriendRequests
          requests={friendRequests}
          onRespond={respondToRequest}
        />

        <FriendsList
          friends={friends}
          selectedFriend={selectedFriend}
          onSelectFriend={(friend) => {
            setSelectedFriend(friend);
            localStorage.setItem("lastFriendId", String(friend.id));
            fetchMessages(friend.id, user?.id);
          }}
        />
      </div>

      {/* Chat Area */}
      <div
        className={`flex-1 flex-col w-full ${
          selectedFriend ? "flex" : "hidden md:flex"
        }`}
      >
        {selectedFriend ? (
          <>
            {/* Header */}
            <div className="p-4 border-b border-border bg-card">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setSelectedFriend(null);
                    localStorage.removeItem("lastFriendId");
                  }}
                  className="md:hidden"
                >
                  ←
                </Button>
                <Avatar>
                  <AvatarFallback className="bg-secondary">
                    {selectedFriend.username.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold">{selectedFriend.username}</p>
                  <p className="text-xs text-muted-foreground">
                    {selectedFriend.online ? "Online" : "Offline"}
                  </p>
                </div>
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4">
                {messages.map((message) => (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    isOwn={message.senderId === user?.id}
                  />
                ))}

                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Input */}
            <div className="p-4 border-t border-border bg-card">
              <form onSubmit={handleSendMessage} className="flex gap-2">
                <Input
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 bg-secondary"
                />
                <Button type="submit" size="icon">
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <p className="text-xl mb-2">Select a friend to start chatting</p>
              <p className="text-sm">Or add new friends using the + button</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Chat;
