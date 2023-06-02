import { parseConversationKey } from '@lib/conversationKey';
import type { ContentTypeId, Conversation, SendOptions } from '@xmtp/xmtp-js';
import { useEffect, useMemo, useState } from 'react';
import { useMessageStore } from 'src/store/message';
import type { RemoteAttachment } from 'xmtp-content-type-remote-attachment';

export type PendingMessage = {
  status: 'pending';
  id: string;
  content: any;
  contentType: ContentTypeId;
  error?: Error;
  options?: SendOptions;
  sent: Date;
  senderAddress: string;
};

export type FailedMessage = Omit<PendingMessage, 'status'> & {
  status: 'failed';
  retry: () => Promise<void>;
  cancel: () => void;
};

export type MessageQueue = (PendingMessage | FailedMessage)[];

export type PreparedMessage = Awaited<
  ReturnType<Conversation['prepareMessage']>
>;

export type AllowedContent = string | RemoteAttachment;

export type SendMessageOptions = {
  fallback?: string;
  preparedMessage?: PreparedMessage;
};

export type SendMessageContent<T extends AllowedContent = string> =
  T extends string ? T : () => Promise<T>;

const useSendOptimisticMessage = (conversationKey: string) => {
  const client = useMessageStore((state) => state.client);
  const conversations = useMessageStore((state) => state.conversations);
  const messages = useMessageStore((state) =>
    state.messages.get(conversationKey)
  );
  const addConversation = useMessageStore((state) => state.addConversation);
  const [missingXmtpAuth, setMissingXmtpAuth] = useState<boolean>(false);

  // queue of messages that failed to send
  const [queue, setQueue] = useState<
    Map<string, FailedMessage | PendingMessage>
  >(new Map());

  // when this conversation's messages are updated in the store,
  // remove any pending/failed messages from the queue
  useEffect(() => {
    let queuedMessageId: string | undefined;

    // look for queued messages in the conversation messages
    messages?.some((message) => {
      const queuedMessage = queue.get(message.id);
      if (queuedMessage) {
        queuedMessageId = queuedMessage.id;
        return true;
      }
    });

    // if a queue message has been found, remove it
    if (queuedMessageId) {
      // remove message from queue
      setQueue((prev) => {
        const updatedQueue = new Map(prev);
        updatedQueue.delete(queuedMessageId as string);
        return updatedQueue;
      });
    }

    // since we update the queue in this effect, remove it from deps so that
    // it doesn't run twice in a row
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  const sendMessage = async <T extends AllowedContent = string>(
    content: SendMessageContent<T>,
    contentType: ContentTypeId,
    options?: SendMessageOptions
  ): Promise<boolean> => {
    if (!client || !conversationKey) {
      return false;
    }

    let conversation;

    if (!missingXmtpAuth && !conversations.has(conversationKey)) {
      const conversationId = conversationKey?.split('/')[0];

      const conversationXmtpId =
        parseConversationKey(conversationKey)?.conversationId ?? '';

      conversation =
        conversationXmtpId !== ''
          ? await client.conversations.newConversation(conversationId, {
              conversationId: conversationXmtpId,
              metadata: {}
            })
          : await client.conversations.newConversation(conversationId);

      addConversation(conversationKey, conversation);
    } else {
      conversation = conversations.get(conversationKey);
    }

    if (!conversation) {
      return false;
    }

    // temporary sent date, will display while sending
    const sent = new Date();
    const senderAddress = conversation.clientAddress;

    let prepared: PreparedMessage;
    let id: string;

    if (!options?.preparedMessage) {
      // prepare message to be sent
      prepared = await conversation.prepareMessage(content, {
        contentType,
        contentFallback: options?.fallback
      });
      id = await prepared.messageID();
    } else {
      // message is already prepared, use existing
      prepared = options.preparedMessage;
      id = await prepared.messageID();
    }

    // add message to queue as pending
    setQueue((prev) => {
      const updatedQueue = new Map(prev);
      updatedQueue.set(id, {
        status: 'pending',
        id,
        content,
        contentType,
        sent,
        senderAddress
      });
      return updatedQueue;
    });

    try {
      // send prepared message
      console.log('sending prepared message', content, contentType);
      await prepared.send();
    } catch (error) {
      console.error('Failed to send message', error);

      // remove pending message from queue
      setQueue((prev) => {
        const updatedQueue = new Map(prev);
        updatedQueue.delete(id);
        return updatedQueue;
      });

      // add message to queue as failed
      setQueue((prev) => {
        const updatedQueue = new Map(prev);
        updatedQueue.set(id, {
          status: 'failed',
          id,
          content,
          contentType,
          sent,
          senderAddress,
          cancel: () => {
            // remove failed message from queue
            setQueue((prev) => {
              const updatedQueue = new Map(prev);
              updatedQueue.delete(id);
              return updatedQueue;
            });
          },
          retry: async () => {
            // remove failed message from queue
            setQueue((prev) => {
              const updatedQueue = new Map(prev);
              updatedQueue.delete(id);
              return updatedQueue;
            });
            // re-send failed message
            await sendMessage(content, contentType, options);
          }
        });
        return updatedQueue;
      });

      return false;
    }
    return true;
  };

  useEffect(() => {
    const checkUserIsOnXmtp = async () => {
      if (client && !conversations.has(conversationKey)) {
        const conversationId = conversationKey?.split('/')[0];
        const canMessage = await client.canMessage(conversationId);
        setMissingXmtpAuth(!canMessage);

        if (!canMessage || !conversationId) {
          return false;
        }
      }
    };
    checkUserIsOnXmtp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationKey, client]);

  // sorted queue of pending and failed messages
  const sortedQueue = useMemo(
    () =>
      Array.from(queue.values()).sort(
        (a, b) => b.sent.getTime() - a.sent.getTime()
      ),
    [queue]
  );

  return { sendMessage, missingXmtpAuth, queue: sortedQueue };
};

export default useSendOptimisticMessage;
