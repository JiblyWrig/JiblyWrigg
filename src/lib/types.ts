export type UserId = "user1" | "user2";

export type FileType = "image" | "video" | "audio" | "file" | null;

export interface ChatMessage {
  id: string;
  sender_id: UserId;
  content: string;
  file_url: string | null;
  file_type: FileType;
  file_name: string | null;
  created_at: number; // epoch ms
  read_at: number | null;
  delivered_at: number | null;
  /** optional sticker / single big emoji */
  sticker?: string | null;
  pinned?: boolean;
  reply_to?: string | null;
}

export interface Identity {
  id: UserId;
  name: string;
  /** emoji avatar */
  avatar: string;
  /** gradient classes for the avatar ring */
  color: string;
}

export const IDENTITIES: Record<UserId, Identity> = {
  user1: {
    id: "user1",
    name: "You",
    avatar: "🧑",
    color: "from-violet-400 to-fuchsia-400",
  },
  user2: {
    id: "user2",
    name: "Love",
    avatar: "💜",
    color: "from-pink-400 to-purple-400",
  },
};

export const PARTNER: Record<UserId, UserId> = {
  user1: "user2",
  user2: "user1",
};
