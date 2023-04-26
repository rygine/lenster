import useXmtpClient from '@components/utils/hooks/useXmtpClient';
import { buildConversationKey } from '@lib/conversationKey';
import type { Conversation } from '@xmtp/xmtp-js';
import { SortDirection } from '@xmtp/xmtp-js';
import type { DecodedMessage } from '@xmtp/xmtp-js/dist/types/src/Message';
import { useEffect, useRef, useState } from 'react';
import { useMessageStore } from 'src/store/message';

const fetchMostRecentMessage = async (
  convo: Conversation
): Promise<{ key: string; message?: DecodedMessage }> => {
  const key = buildConversationKey(convo.peerAddress, convo.context?.conversationId as string);

  const newMessages = await convo.messages({
    limit: 1,
    direction: SortDirection.SORT_DIRECTION_DESCENDING
  });
  if (newMessages.length <= 0) {
    return { key };
  }
  return { key, message: newMessages[0] };
};

const useGetMessagePreviews = () => {
  const conversations = useMessageStore((state) => state.conversations);
  const previewMessages = useMessageStore((state) => state.previewMessages);
  const setPreviewMessage = useMessageStore((state) => state.setPreviewMessage);
  const { client } = useXmtpClient();
  const [loading, setLoading] = useState<boolean>(false);
  const loadingRef = useRef<boolean>(false);

  useEffect(() => {
    if (!client) {
      return;
    }

    // const getMessagePreviews = async () => {
    //   loadingRef.current = true;
    //   setLoading(true);

    //   const preview = await fetchMostRecentMessage(convo);

    //   if (preview.message) {
    //     setPreviewMessage(preview.key, preview.message);
    //   }
    //   setLoading(false);
    //   loadingRef.current = false;
    // };

    // getMessagePreviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  return {
    loading
  };
};

export default useGetMessagePreviews;
