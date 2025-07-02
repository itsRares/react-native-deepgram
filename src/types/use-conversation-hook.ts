export type Message = {
  role: string;
  content: string;
  timestamp: number;
};

export type UseConversationHook<Props = any, Return = any> = (
  props: Props
) => Return;
