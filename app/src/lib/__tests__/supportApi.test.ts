jest.mock('../supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

import { listSupportThreads, loadSupportConversation, type SupportMessage, type SupportThread } from '../adminApi';
import { supabase } from '../supabase';

function threadQuery(result: { data: SupportThread | null; error: { message: string } | null }) {
  const query = {
    select: jest.fn(),
    eq: jest.fn(),
    maybeSingle: jest.fn().mockResolvedValue(result),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

function messagesQuery(result: { data: SupportMessage[]; error: { message: string } | null }) {
  const query = {
    select: jest.fn(),
    eq: jest.fn(),
    order: jest.fn().mockResolvedValue(result),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

const ownThread = {
  id: 'thread-own',
  user_id: 'actor-1',
  booking_id: null,
  subject: 'Payment help',
  status: 'open',
  user_unread: 0,
  admin_unread: 1,
  last_message: 'Please help',
  last_from_admin: false,
  last_message_at: '2026-01-02T03:04:05.000Z',
  created_at: '2026-01-02T03:04:05.000Z',
} satisfies SupportThread;

const ownMessage = {
  id: 'message-own',
  thread_id: ownThread.id,
  sender_id: ownThread.user_id,
  from_admin: false,
  body: 'Please help',
  created_at: ownThread.created_at,
} satisfies SupportMessage;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('support API scope', () => {
  it('CM_SUPPORT_PERSONAL_LIST_SCOPE filters the personal list to the verified actor', async () => {
    const query = {
      select: jest.fn(),
      eq: jest.fn(),
      order: jest.fn().mockResolvedValue({ data: [ownThread], error: null }),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    (supabase.from as jest.Mock).mockReturnValue(query);

    await expect(listSupportThreads('actor-1')).resolves.toEqual([ownThread]);

    expect(supabase.from).toHaveBeenCalledWith('support_threads');
    expect(query.eq).toHaveBeenCalledWith('user_id', 'actor-1');
    expect(query.order).toHaveBeenCalledWith('last_message_at', { ascending: false });
  });

  it('CM_SUPPORT_PERSONAL_DETAIL_SCOPE requires ownership before fetching messages and retains admin RLS scope', async () => {
    const notOwnedQuery = threadQuery({ data: null, error: null });
    (supabase.from as jest.Mock).mockReturnValue(notOwnedQuery);
    await expect(loadSupportConversation('someone-elses-thread', 'participant', 'actor-1'))
      .resolves.toEqual({ thread: null, messages: [] });
    expect(notOwnedQuery.eq).toHaveBeenNthCalledWith(1, 'id', 'someone-elses-thread');
    expect(notOwnedQuery.eq).toHaveBeenNthCalledWith(2, 'user_id', 'actor-1');
    expect(supabase.from).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    const ownerThreadQuery = threadQuery({ data: ownThread, error: null });
    const ownerMessagesQuery = messagesQuery({ data: [ownMessage], error: null });
    (supabase.from as jest.Mock).mockImplementation((table: string) =>
      table === 'support_threads' ? ownerThreadQuery : ownerMessagesQuery,
    );
    await expect(loadSupportConversation(ownThread.id, 'participant', 'actor-1')).resolves.toEqual({
      thread: ownThread,
      messages: [ownMessage],
    });
    expect(ownerThreadQuery.eq).toHaveBeenNthCalledWith(2, 'user_id', 'actor-1');
    expect(ownerMessagesQuery.eq).toHaveBeenCalledWith('thread_id', ownThread.id);

    jest.clearAllMocks();
    const adminThreadQuery = threadQuery({ data: { ...ownThread, user_id: 'another-user' }, error: null });
    const adminMessagesQuery = messagesQuery({ data: [ownMessage], error: null });
    (supabase.from as jest.Mock).mockImplementation((table: string) =>
      table === 'support_threads' ? adminThreadQuery : adminMessagesQuery,
    );

    await expect(loadSupportConversation('thread-admin', 'admin', 'admin-1')).resolves.toEqual({
      thread: { ...ownThread, user_id: 'another-user' },
      messages: [ownMessage],
    });
    expect(adminThreadQuery.eq).toHaveBeenCalledTimes(1);
    expect(adminThreadQuery.eq).toHaveBeenCalledWith('id', 'thread-admin');
    expect(adminMessagesQuery.eq).toHaveBeenCalledWith('thread_id', 'thread-admin');
  });
});
