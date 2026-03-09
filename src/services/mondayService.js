import axios from 'axios';
import mondaySdk from 'monday-sdk-js';

const MONDAY_API_URL = 'https://api.monday.com/v2';
const API_KEY = process.env.REACT_APP_MONDAY_API_KEY || '';
const API_PROXY_URL = (process.env.REACT_APP_API_URL || '').replace(/\/$/, '');

const GET_BOARDS_QUERY = `
  query GetBoards($limit: Int) {
    boards(limit: $limit) {
      id
      name
    }
  }
`;

const GET_WORKSPACE_USERS_QUERY = `
  query GetWorkspaceUsers($workspaceIds: [Int]) {
    workspaces(ids: $workspaceIds) {
      id
      users_subscribers {
        id
        name
        email
        photo_thumb_small
        photo_original
      }
    }
  }
`;

const GET_BOARD_ITEMS_QUERY = `
  query GetBoardItems($boardId: [ID!]) {
    boards(ids: $boardId) {
      id
      name
      workspace_id
      columns {
        id
        title
        type
        settings_str
      }
      groups { id title }
      subscribers {
        id
        name
        email
        photo_thumb_small
        photo_original
      }
      items_page(limit: 500) {
        items {
          id
          name
          group { id title }
          column_values { id text type value }
        }
      }
    }
  }
`;

/** ბორდი + ყველა account მომხმარებელი ერთ მოთხოვნაში – Person dropdown-ისთვის */
const GET_BOARD_WITH_USERS_QUERY = `
  query GetBoardWithUsers($boardId: [ID!]) {
    boards(ids: $boardId) {
      id
      name
      workspace_id
      columns {
        id
        title
        type
        settings_str
      }
      groups { id title }
      subscribers {
        id
        name
        email
        photo_thumb_small
        photo_original
      }
      items_page(limit: 500) {
        items {
          id
          name
          group { id title }
          column_values { id text type value }
        }
      }
    }
    account_users: users {
      id
      name
      email
      photo_thumb_small
      photo_original
    }
  }
`;

const GET_USERS_QUERY = `
  query GetUsers($ids: [Int]) {
    users (ids: $ids) {
      id
      name
      email
      photo_original
      photo_thumb_small
    }
  }
`;

const GET_ALL_USERS_QUERY = `
  query { users { id name email photo_thumb_small photo_original } }
`;

const CHANGE_SIMPLE_COLUMN_VALUE_MUTATION = `
  mutation ChangeSimpleColumnValue($itemId: ID!, $boardId: ID!, $columnId: String!, $value: String!) {
    change_simple_column_value(item_id: $itemId, board_id: $boardId, column_id: $columnId, value: $value) {
      id
    }
  }
`;

const CHANGE_COLUMN_VALUE_MUTATION = `
  mutation ChangeColumnValue($itemId: ID!, $boardId: ID!, $columnId: String!, $value: JSON!) {
    change_column_value(item_id: $itemId, board_id: $boardId, column_id: $columnId, value: $value) {
      id
    }
  }
`;

const MOVE_ITEM_TO_BOARD_MUTATION = `
  mutation MoveItemToBoard($itemId: ID!, $boardId: ID!, $groupId: String!) {
    move_item_to_board(item_id: $itemId, board_id: $boardId, group_id: $groupId) {
      id
    }
  }
`;

const CREATE_ITEM_MUTATION = `
  mutation CreateItem($boardId: ID!, $groupId: String!, $itemName: String!) {
    create_item(board_id: $boardId, group_id: $groupId, item_name: $itemName) {
      id
    }
  }
`;

const DELETE_ITEM_MUTATION = `
  mutation DeleteItem($itemId: ID!) {
    delete_item(item_id: $itemId) {
      id
    }
  }
`;

let mondayClient = null;

/** ოფიციალური monday-sdk-js ინსტანცია – Monday iframe-ში ჰოსტთან კომუნიკაციას აკეთებს. */
function getMondayClient() {
  if (typeof window === 'undefined') return null;
  if (!mondayClient) mondayClient = mondaySdk();
  return mondayClient;
}

function getMondayApi() {
  const client = getMondayClient();
  if (client && typeof client.api === 'function') return client;
  return null;
}

/**
 * SDK ჩატვირთულია npm-ით – ლოდინი აღარ სჭირდება; უბრუნებს მიმდინარე კლიენტს.
 * @param {number} _maxWaitMs – არ გამოიყენება (შენარჩუნებულია App.js-თან თავსებადობისთვის)
 */
function waitForMondayApi(_maxWaitMs = 5000) {
  return Promise.resolve(getMondayApi());
}

function hasApi() {
  return getMondayApi() || (API_KEY && API_KEY.trim()) || (API_PROXY_URL && API_PROXY_URL.trim());
}

const STORAGE_KEY_BOARDS = 'kandan-selected-board-ids';

/** არჩეული ბორდების ID-ების შენახვა – Monday iframe-ში monday.storage, სხვაგან localStorage */
async function getBoardIdsFromStorage() {
  try {
    const monday = getMondayApi();
    if (monday?.storage?.getItem) {
      const res = await monday.storage.getItem(STORAGE_KEY_BOARDS);
      const raw = res?.data?.value ?? res?.value ?? res?.data;
      const str = typeof raw === 'string' ? raw : (raw != null ? JSON.stringify(raw) : null);
      if (str) {
        const parsed = JSON.parse(str);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(String).filter(Boolean);
        }
      }
    }
  } catch (e) {}
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY_BOARDS) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(String).filter(Boolean);
      }
    }
  } catch (e) {}
  return [];
}

/** არჩეული ბორდების ID-ების ჩაწერა */
async function setBoardIdsToStorage(ids) {
  const value = JSON.stringify(ids || []);
  try {
    const monday = getMondayApi();
    if (monday?.storage?.setItem) {
      await monday.storage.setItem(STORAGE_KEY_BOARDS, value);
      return;
    }
  } catch (e) {}
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_BOARDS, value);
    }
  } catch (e) {}
}

/** Monday-ში ღია ბორდის ID (monday.get('context')), თუ არ ვართ ბორდის კონტექსტში – null */
async function getCurrentBoardId() {
  const monday = getMondayApi();
  if (!monday || typeof monday.get !== 'function') return null;
  try {
    const res = await monday.get('context');
    const boardId = res?.data?.boardId ?? res?.data?.board?.id ?? null;
    if (boardId) console.log('[Monday API] მიმდინარე ბორდის ID (context):', boardId);
    return boardId ? String(boardId) : null;
  } catch (e) {
    console.warn('[Monday API] context ვერ მოიძებნა:', e);
    return null;
  }
}

/**
 * monday.listen('context') – იღებს კონტექსტს; callback იძახება context-ით (res.data ან res).
 * @param {function} callback - (context) => {} სადაც context = { boardId, ... }
 * @returns {function|void} unsubscribe (თუ listen აბრუნებს), წინააღმდეგ შემთხვევაში undefined
 */
function listenContext(callback) {
  const monday = getMondayApi();
  if (!monday || typeof monday.listen !== 'function') return;
  const forwardContext = (res) => {
    const context = res?.data ?? res ?? {};
    const hasBoardId = Boolean(context?.boardId || context?.data?.boardId);
    const hasTheme = Boolean(
      context?.theme ||
      context?.themeConfig ||
      context?.theme?.name ||
      context?.user?.theme ||
      context?.data?.theme ||
      context?.data?.themeConfig
    );
    // ვუშვებთ ყველა event-ს, სადაც boardId ან theme info ჩანს.
    if (!hasBoardId && !hasTheme) {
      console.log('[Monday API] context (listen) – boardId არ არის, გამოტოვება:', res?.kind || 'no boardId');
      return;
    }
    console.log('[Monday API] context (listen):', context);
    callback(context);
  };
  monday.listen('context', forwardContext);

  // ზოგი account-ში theme ცვლილება context-ზე კი არა settings-ზე იგზავნება.
  monday.listen('settings', (res) => {
    const data = res?.data ?? res ?? {};
    const maybeTheme =
      data?.theme ||
      data?.themeConfig ||
      data?.theme?.name ||
      data?.themeConfig?.name ||
      data?.themeConfig?.theme;
    if (maybeTheme) {
      callback({ theme: maybeTheme, themeConfig: data?.themeConfig || undefined });
    }
  });
}

/**
 * ბორდზე ცვლილებების მოსმენა (item update/create/delete და ფილტრის ცვლილებები).
 * callback იძახება მხოლოდ მაშინ, როცა SDK-დან events/itemIds მოვა.
 */
function listenBoardChanges(callback) {
  const monday = getMondayApi();
  if (!monday || typeof monday.listen !== 'function') return;
  monday.listen(['events', 'itemIds'], (res) => {
    const data = res?.data ?? res ?? {};
    callback(data);
  });
}

async function makeRequest(query, variables = {}) {
  const monday = getMondayApi();
  if (monday) {
    let res = null;
    try {
      res = await monday.api(query, { variables });
    } catch (e) {
      console.warn('[Monday API] monday.api შეცდომა (შესაძლოა არ ვართ Monday iframe-ში):', e?.message);
      // მხოლოდ ტრანსპორტ/iframe შეცდომებზე ვცდილობთ fallback-ს.
      if (!API_PROXY_URL && !API_KEY) throw e;
    }
    if (res) {
      console.log('[Monday API] პასუხი (სრული):', res);
      if (res.errors && res.errors.length) throw new Error(res.errors[0].message);
      if (res.data) return res.data;
      if (res.boards !== undefined) return res;
      return res || null;
    }
  }
  if (API_PROXY_URL) {
    const { data } = await axios.post(`${API_PROXY_URL}/api/monday`, { query, variables }, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 });
    console.log('[Monday API] Proxy პასუხი (სრული):', data);
    if (data.errors && data.errors.length) throw new Error(data.errors[0].message);
    return data.data || null;
  }
  const response = await axios.post(MONDAY_API_URL, { query, variables }, {
    headers: { 'Content-Type': 'application/json', 'Authorization': API_KEY, 'API-Version': '2024-01' },
    timeout: 30000
  });
  console.log('[Monday API] პასუხი (სრული):', response.data);
  if (response.data.errors && response.data.errors.length) throw new Error(response.data.errors[0].message);
  return response.data.data || null;
}

function toMondayDateString(input) {
  const value = String(input || '').trim();
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function updateItemDetails(item, updates = {}) {
  const itemId = item?.id ? String(item.id) : null;
  const boardId = item?.boardId ? String(item.boardId) : null;
  if (!itemId || !boardId) throw new Error('item/board ინფორმაცია არ არის საკმარისი');

  const hasTitleUpdate = Object.prototype.hasOwnProperty.call(updates, 'title');
  const nextTitle = String(updates.title ?? '').trim();
  const prevTitle = String(item.title || '').trim();
  if (hasTitleUpdate && nextTitle && nextTitle !== prevTitle) {
    await makeRequest(CHANGE_SIMPLE_COLUMN_VALUE_MUTATION, {
      itemId,
      boardId,
      columnId: 'name',
      value: nextTitle
    });
  }

  const hasStatusUpdate = Object.prototype.hasOwnProperty.call(updates, 'statusText');
  const nextStatus = String(updates.statusText ?? '').trim();
  const prevStatus = String(item.statusText || '').trim();
  const statusOptions = Array.isArray(item.statusOptions) ? item.statusOptions : [];
  const normalizedNext = nextStatus.toLowerCase();
  const matchingOption = statusOptions.find((opt) => String(opt?.label || '').trim().toLowerCase() === normalizedNext);
  // თუ "Uncategorized" Monday-ში რეალური სტატუსის ლეიბლად არ არსებობს, სტატუსს აღარ ვშლით.
  const resolvedStatus = matchingOption ? String(matchingOption.label).trim() : (
    normalizedNext === 'uncategorized' ? '' : nextStatus
  );
  const shouldUpdateStatus = hasStatusUpdate && item.statusColumnId && resolvedStatus && resolvedStatus !== prevStatus;
  if (shouldUpdateStatus) {
    await makeRequest(CHANGE_SIMPLE_COLUMN_VALUE_MUTATION, {
      itemId,
      boardId,
      columnId: String(item.statusColumnId),
      value: resolvedStatus
    });
  }

  const hasDateUpdate = Object.prototype.hasOwnProperty.call(updates, 'dateText');
  const nextDate = toMondayDateString(updates.dateText);
  const prevDate = toMondayDateString(item.dateText);
  if (hasDateUpdate && item.dateColumnId && nextDate !== prevDate) {
    await makeRequest(CHANGE_SIMPLE_COLUMN_VALUE_MUTATION, {
      itemId,
      boardId,
      columnId: String(item.dateColumnId),
      value: nextDate
    });
  }

  const hasPersonUpdate = Object.prototype.hasOwnProperty.call(updates, 'personId');
  const prevPersonId = item.assignee?.id ? String(item.assignee.id) : '';
  const nextPersonId = updates.personId ? String(updates.personId) : '';
  if (hasPersonUpdate && item.personColumnId && nextPersonId !== prevPersonId) {
    const personId = nextPersonId ? Number(nextPersonId) : null;
    const value = personId
      ? JSON.stringify({ personsAndTeams: [{ id: personId, kind: 'person' }] })
      : JSON.stringify({ personsAndTeams: [] });
    await makeRequest(CHANGE_COLUMN_VALUE_MUTATION, {
      itemId,
      boardId,
      columnId: String(item.personColumnId),
      value
    });
  }

  const hasGroupUpdate = Object.prototype.hasOwnProperty.call(updates, 'groupId');
  if (hasGroupUpdate && typeof updates.groupId === 'string' && updates.groupId && updates.groupId !== String(item.groupId || '')) {
    await makeRequest(MOVE_ITEM_TO_BOARD_MUTATION, {
      itemId,
      boardId,
      groupId: updates.groupId
    });
  }

  const hasExtraFieldsUpdate = Object.prototype.hasOwnProperty.call(updates, 'extraFields');
  if (hasExtraFieldsUpdate && updates.extraFields && typeof updates.extraFields === 'object') {
    const extraFields = Array.isArray(item.extraFields) ? item.extraFields : [];
    for (const field of extraFields) {
      const columnId = String(field?.id || '');
      if (!columnId) continue;
      const prevValue = String(field?.value || '');
      const nextValue = String(updates.extraFields[columnId] ?? '');
      if (nextValue === prevValue) continue;
      await makeRequest(CHANGE_SIMPLE_COLUMN_VALUE_MUTATION, {
        itemId,
        boardId,
        columnId,
        value: nextValue
      });
    }
  }
}

/**
 * ახალი აითემის შექმნა ბორდზე მოცემულ status-ზე.
 * @param {Object} params
 * @param {string} params.boardId
 * @param {string} params.groupId
 * @param {string} params.statusColumnId
 * @param {string} params.statusLabel – სტატუსის ლეიბლი
 * @param {string} [params.itemName='ახალი კლიენტი']
 */
async function createItem({ boardId, groupId, statusColumnId, statusLabel, itemName = 'ახალი კლიენტი' }) {
  const bid = boardId ? String(boardId).trim() : '';
  const gid = String(groupId || '').trim();
  if (!bid || !gid) throw new Error('boardId და groupId სავალდებულოა');
  const name = String(itemName || 'ახალი კლიენტი').trim() || 'ახალი კლიენტი';
  const createData = await makeRequest(CREATE_ITEM_MUTATION, { boardId: bid, groupId: gid, itemName: name });
  const id = createData?.create_item?.id;
  if (!id) throw new Error('create_item არ დააბრუნა id');
  if (statusColumnId && statusLabel) {
    try {
      await makeRequest(CHANGE_SIMPLE_COLUMN_VALUE_MUTATION, {
        itemId: id,
        boardId: bid,
        columnId: String(statusColumnId),
        value: String(statusLabel)
      });
    } catch (e) {
      console.warn('[Monday API] create_item წარმატებული, status update ვერ მოხერხდა:', e?.message);
    }
  }
  return { id };
}

async function deleteItem(itemId) {
  const id = itemId ? String(itemId) : null;
  if (!id) throw new Error('itemId სავალდებულოა');
  await makeRequest(DELETE_ITEM_MUTATION, { itemId: id });
  return { id };
}

async function fetchBoards(limit = 50) {
  const data = await makeRequest(GET_BOARDS_QUERY, { limit });
  const boards = (data && data.boards) || (data && Array.isArray(data) ? data : null);
  console.log('[Monday API] ბორდების მონაცემები:', boards || data);
  if (!boards || !boards.length) throw new Error('ბორდები არ მოიძებნა');
  return boards;
}

/** Person/People სვეტის settings_str-იდან suggested ან allowed user IDs */
function extractSuggestedPersonIdsFromColumns(columns = []) {
  const ids = new Set();
  (columns || []).forEach((col) => {
    if (!col || (col.type || '').toLowerCase() !== 'people' && (col.type || '').toLowerCase() !== 'person') return;
    const str = col.settings_str;
    if (!str || typeof str !== 'string') return;
    try {
      const parsed = JSON.parse(str);
      const arr =
        parsed?.person_ids ||
        parsed?.suggested_user_ids ||
        parsed?.allowed_user_ids ||
        parsed?.user_ids ||
        (Array.isArray(parsed?.persons) ? parsed.persons.map((p) => p?.id ?? p).filter(Boolean) : []);
      (arr || []).forEach((id) => {
        const n = typeof id === 'number' ? id : parseInt(id, 10);
        if (!Number.isNaN(n)) ids.add(n);
      });
    } catch (e) {
      /* ignore */
    }
  });
  return Array.from(ids);
}

async function fetchBoardItems(boardId) {
  let data;
  try {
    data = await makeRequest(GET_BOARD_WITH_USERS_QUERY, { boardId: [boardId] });
  } catch (e) {
    data = await makeRequest(GET_BOARD_ITEMS_QUERY, { boardId: [boardId] });
  }
  const boards = (data && data.boards) || (Array.isArray(data) ? data : null);
  if (!boards || !boards.length) throw new Error('ბორდი არ მოიძებნა');
  const board = boards[0];
  const accountUsers = data?.account_users || [];
  // Column ID -> title/type map, რომ შევძლოთ მხოლოდ "Data" სვეტის გამოყვანა
  if (Array.isArray(board.columns)) {
    const columnsById = {};
    let personColumnId = null;
    board.columns.forEach((col) => {
      if (!col || !col.id) return;
      const cid = String(col.id);
      const ctype = (col.type || '').toLowerCase();
      columnsById[cid] = { id: cid, title: col.title || '', type: col.type || '' };
      if (!personColumnId && (ctype === 'people' || ctype === 'person')) {
        personColumnId = cid;
      }
    });
    board.__columnsById = columnsById;
    board.__statusOptionsByColumnId = buildStatusOptionsByColumnId(board);
    board.__personColumnId = personColumnId;
  }
  board.__groups = Array.isArray(board.groups) ? board.groups.map((g) => ({ id: String(g.id), title: g.title || '' })) : [];
  board.__usersById = board.__usersById || {};
  if (!board.items_page && Array.isArray(board.items)) board.items_page = { items: board.items };
  if (!board.items_page || !board.items_page.items) board.items_page = { items: [] };
  const getPhotoUrl = (u) => {
    if (!u) return null;
    const raw = u.photo_thumb_small || u.photo_original || u.photo_small || u.photo_original_url
      || u.avatar || u.avatar_small || u.url || null;
    if (typeof raw === 'string') return raw;
    if (raw && typeof raw === 'object' && raw.url) return raw.url;
    if (raw && typeof raw === 'object') return raw.thumb_small || raw.thumbSmall || raw.original || null;
    return null;
  };
  const addUser = (u, usersById) => {
    if (!u || u.id == null) return;
    const id = String(u.id);
    const userObj = {
      id,
      name: u.name || '',
      email: u.email || '',
      photoUrl: getPhotoUrl(u)
    };
    usersById[id] = userObj;
    if (!/^person_/i.test(id)) usersById[`person_${id}`] = userObj;
  };
  try {
    const subscribers = board.subscribers || [];
    subscribers.forEach((s) => addUser(s, board.__usersById));
    const items = board.items_page.items || [];
    const userIds = Array.from(new Set(
      items
        .flatMap((item) => (item.column_values || []))
        .filter((cv) => isPersonColumn(cv))
        .flatMap((cv) => {
          if (!cv.value) return [];
          try {
            const parsed = JSON.parse(cv.value);
            const arr = parsed?.personsAndTeams || parsed?.persons || [];
            return arr
              .filter((x) => x && x.id != null)
              .map((x) => {
                const raw = x.id;
                if (typeof raw === 'number') return raw;
                const s = String(raw).replace(/^person_/i, '');
                const n = parseInt(s, 10);
                return Number.isNaN(n) ? null : n;
              })
              .filter((n) => n != null);
          } catch (e) {
            return [];
          }
        })
    ));
    if (userIds.length) {
      const usersData = await makeRequest(GET_USERS_QUERY, { ids: userIds });
      (usersData?.users || []).forEach((u) => addUser(u, board.__usersById));
    }
    // ყველა account მომხმარებელი – Person dropdown-ში ყველა ემაილი
    const allAccountUsers = Array.isArray(accountUsers) ? accountUsers : [];
    allAccountUsers.forEach((u) => addUser(u, board.__usersById));
    if (allAccountUsers.length === 0) {
      try {
        const res = await makeRequest(GET_ALL_USERS_QUERY, {});
        (res?.users || []).forEach((u) => addUser(u, board.__usersById));
      } catch (e) {
        console.warn('[Monday API] users ვერ მოიძებნა:', e?.message);
      }
    }
    // Workspace მომხმარებლები (სხვა წყაროებიდან რაც არ მოვიდა)
    const workspaceId = board.workspace_id ?? board.workspace?.id;
    if (workspaceId) {
      try {
        const wsRes = await makeRequest(GET_WORKSPACE_USERS_QUERY, {
          workspaceIds: [typeof workspaceId === 'number' ? workspaceId : parseInt(workspaceId, 10)]
        });
        const workspaces = wsRes?.workspaces || [];
        workspaces.forEach((ws) => {
          (ws.users_subscribers || []).forEach((u) => addUser(u, board.__usersById));
        });
      } catch (e) {
        /* ignore */
      }
    }
    // Person სვეტის settings_str-იდან suggested/allowed user IDs
    const suggestedIds = extractSuggestedPersonIdsFromColumns(board.columns);
    if (suggestedIds.length) {
      const suggestedData = await makeRequest(GET_USERS_QUERY, { ids: suggestedIds });
      (suggestedData?.users || []).forEach((u) => addUser(u, board.__usersById));
    }
    board.__assigneeOptions = Object.values(board.__usersById).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    // მომხმარებლები ფოტოების გარეშე – ვემატებთ GET_USERS_QUERY-ით (ყველას ფოტოს მისაღებად)
    const missingPhotoIds = Object.entries(board.__usersById)
      .filter(([, u]) => !u.photoUrl)
      .map(([id]) => parseInt(id, 10))
      .filter((n) => !Number.isNaN(n));
    if (missingPhotoIds.length) {
      try {
        const photoRes = await makeRequest(GET_USERS_QUERY, { ids: missingPhotoIds });
        (photoRes?.users || []).forEach((u) => addUser(u, board.__usersById));
      } catch (e) {
        /* ignore */
      }
    }
  } catch (e) {
    console.warn('[Monday API] მომხმარებლების ამოღება ვერ მოხერხდა (avatar-ები გამოტოვდება):', e?.message);
  }
  if (!board.__assigneeOptions) board.__assigneeOptions = [];
  console.log('[Monday API] ბორდის მონაცემები:', board);
  console.log('[Monday API] ბორდის items:', board.items_page.items);
  return board;
}

// Demo Kanban მონაცემები
const MOCK_BOARD_DATA = {
  'demo-board-1': {
    id: 'demo-board-1',
    name: 'Demo Project Board',
    items_page: {
      items: [
        {
          id: '1',
          name: 'დიზაინის შექმნა',
          column_values: [
            { id: 'status', text: 'In Progress', type: 'status' },
            { id: 'person', text: 'ნიკა ბერიძე', type: 'person' }
          ],
          group: { id: 'default label', title: 'default label' }
        },
        {
          id: '2',
          name: 'API ინტეგრაცია',
          column_values: [
            { id: 'status', text: 'To Do', type: 'status' },
            { id: 'person', text: 'გიორგი მელაძე', type: 'person' }
          ],
          group: { id: 'new', title: 'Stuck' }
        },
        {
          id: '3',
          name: 'ტესტირება',
          column_values: [
            { id: 'status', text: 'Done', type: 'status' },
            { id: 'person', text: 'ანა კვარაცხელია', type: 'person' }
          ],
          group: { id: 'working', title: 'Working on it' }
        },
        {
          id: '4',
          name: 'დოკუმენტაცია',
          column_values: [
            { id: 'status', text: 'In Progress', type: 'status' },
            { id: 'person', text: 'დავით ხარაძე', type: 'person' }
          ],
          group: { id: 'working', title: 'Working on it' }
        },
        {
          id: '5',
          name: 'დეპლოიმენტი',
          column_values: [
            { id: 'status', text: 'Done', type: 'status' },
            { id: 'person', text: 'მარიამ ლომიძე', type: 'person' }
          ],
          group: { id: 'done', title: 'Done' }
        }
      ]
    }
  }
};

/** item-იდან Status სვეტის მნიშვნელობა (column_values სადაც type === 'status' ან id === 'status') */
function getStatusFromItem(item) {
  const col = (item.column_values || []).find(
    (cv) => (cv.type && cv.type.toLowerCase() === 'status') || (cv.id && String(cv.id).toLowerCase() === 'status')
  );
  return (col && col.text && col.text.trim()) ? col.text.trim() : 'Uncategorized';
}

/** Monday.com Person/People სვეტის გამოვლენა – type ან id შეიძლება იყოს person/people/assignee/owner და სხვა. */
function isPersonColumn(cv) {
  const t = (cv?.type || '').toLowerCase();
  const id = String(cv?.id || '').toLowerCase();
  if (t === 'person' || t === 'people') return true;
  const personIds = ['person', 'people', 'assignee', 'owner', 'responsible', 'contact', 'creator', 'account_manager'];
  return personIds.some((pid) => id === pid || id.includes(pid));
}

/** item-იდან Person სვეტის მნიშვნელობა (პერსონის სახელი + ავატარი, თუ გვაქვს usersById) */
function getPersonFromItem(item, usersById = {}, personColumnId = null) {
  const cvList = item.column_values || [];
  let col = personColumnId
    ? cvList.find((cv) => String(cv?.id || '') === String(personColumnId))
    : null;
  if (!col) col = cvList.find(isPersonColumn);
  const fallbackName = (col && col.text && col.text.trim()) ? col.text.trim() : null;

  let personId = null;
  if (col && col.value) {
    try {
      const parsed = JSON.parse(col.value);
      const arr = parsed?.personsAndTeams || parsed?.persons || [];
      const first = Array.isArray(arr) ? arr.find((x) => x && (x.id != null)) : null;
      if (first && first.id != null) {
        personId = String(first.id);
      }
    } catch (e) {
      // value ვერ დაიპარსა – გავაგრძელოთ მხოლოდ სახელით
    }
  }

  let user = personId ? usersById[personId] : null;
  if (!user && personId) {
    const numId = personId.replace(/^person_/i, '');
    user = usersById[numId] || (numId !== personId ? usersById[personId] : null);
  }
  if (!user && !fallbackName) return null;

  return {
    id: user?.id || personId || null,
    name: user?.name || fallbackName,
    email: user?.email || null,
    avatarUrl: user?.photoUrl || null
  };
}

/** item-იდან Date სვეტის მნიშვნელობა (column_values სადაც type === 'date') */
function getDateFromItem(item) {
  const col = (item.column_values || []).find(
    (cv) => (cv.type && cv.type.toLowerCase() === 'date') || (cv.id && String(cv.id).toLowerCase() === 'date')
  );
  return (col && col.text && col.text.trim()) ? col.text.trim() : '';
}

/** item-იდან Connect board / ლინკის სვეტის მნიშვნელობა */
function getConnectBoardFromItem(item) {
  const cols = item.column_values || [];
  const linkCol = cols.find(
    (cv) => (cv.type && (cv.type.toLowerCase() === 'link' || cv.type.toLowerCase() === 'board')) ||
      (cv.id && (String(cv.id).toLowerCase().includes('link') || String(cv.id).toLowerCase().includes('board')))
  );
  if (linkCol && linkCol.text && linkCol.text.trim()) return linkCol.text.trim();
  const any = cols.find((cv) => cv.text && cv.text.trim());
  return (any && any.text.trim()) ? any.text.trim() : '';
}

function buildItemExtraFields(item, columnsById = {}) {
  return (item.column_values || [])
    .map((cv) => {
      const id = String(cv?.id || '');
      const type = String(cv?.type || '').toLowerCase();
      const title = columnsById[id]?.title || id || 'Field';
      const value = String(cv?.text || '').trim();
      return { id, type, title, value };
    })
    .filter((field) => {
      if (field.type === 'status' || field.type === 'person' || field.type === 'people' || field.type === 'date') return false;
      const lowId = field.id.toLowerCase();
      if (lowId === 'status' || lowId === 'person' || lowId === 'people' || lowId === 'date') return false;
      return true;
    });
}

function getColumnValueByType(item, typeName) {
  const type = String(typeName || '').toLowerCase();
  return (item.column_values || []).find(
    (cv) => (cv.type && cv.type.toLowerCase() === type) || (cv.id && String(cv.id).toLowerCase() === type)
  ) || null;
}

function getStatusColumnId(item) {
  return getColumnValueByType(item, 'status')?.id || null;
}

function getDateColumnId(item) {
  return getColumnValueByType(item, 'date')?.id || null;
}

function getPersonColumnId(item) {
  const col = (item.column_values || []).find(isPersonColumn);
  return col?.id || null;
}

const MONDAY_COLOR_TO_HEX = {
  green: '#27ae60',
  red: '#e74c3c',
  orange: '#e67e22',
  yellow: '#f1c40f',
  blue: '#3498db',
  purple: '#9b59b6',
  pink: '#ff7ab8',
  gray: '#95a5a6',
  grey: '#95a5a6',
  black: '#2c3e50',
  brown: '#8e6e53'
};

function toHexColor(colorValue) {
  const value = String(colorValue || '').trim().toLowerCase();
  if (!value) return null;
  if (value.startsWith('#')) return value;
  return MONDAY_COLOR_TO_HEX[value] || null;
}

function extractStatusOptionsFromSettings(settingsStr) {
  if (!settingsStr) return [];
  try {
    const parsed = JSON.parse(settingsStr);
    const labels = parsed?.labels || {};
    const labelsColors = parsed?.labels_colors || {};
    return Object.keys(labels)
      .map((indexKey) => ({
        index: Number(indexKey),
        label: String(labels[indexKey] || '').trim(),
        color: toHexColor(labelsColors[indexKey]?.color)
      }))
      .filter((x) => x.label)
      .sort((a, b) => a.index - b.index);
  } catch (e) {
    return [];
  }
}

function buildStatusOptionsByColumnId(board) {
  const out = {};
  (board.columns || []).forEach((col) => {
    if (!col || (col.type || '').toLowerCase() !== 'status') return;
    const options = extractStatusOptionsFromSettings(col.settings_str);
    if (options.length) out[String(col.id)] = options;
  });
  return out;
}

function getStatusColorByText(statusText, statusOptions) {
  const text = String(statusText || '').trim().toLowerCase();
  if (!text || !Array.isArray(statusOptions)) return null;
  const match = statusOptions.find((opt) => String(opt?.label || '').trim().toLowerCase() === text);
  return match?.color || null;
}

/** Status-ების სასურველი რიგი Kanban სვეტებისთვის (შედარება case-insensitive) */
const STATUS_ORDER = [
  'Working on it',
  'Stuck',
  'Done',
  'Default label'
];

function transformToKanban(boardData) {
  if (!boardData || !boardData.items_page || !boardData.items_page.items) {
    return { columns: [] };
  }
  const items = boardData.items_page.items;
  const boardName = boardData.name || '';
  const usersById = boardData.__usersById || {};
  const columnsById = boardData.__columnsById || {};
  const columnsMap = new Map();
  items.forEach((item) => {
    const groupTitle = item.group?.title || 'Uncategorized';
    if (!columnsMap.has(groupTitle)) {
      columnsMap.set(groupTitle, {
        id: item.group?.id || groupTitle,
        title: groupTitle,
        items: []
      });
    }
    const column = columnsMap.get(groupTitle);
    const statusColumnId = getStatusColumnId(item);
    const statusOptions = (boardData.__statusOptionsByColumnId || {})[String(statusColumnId || '')] || [];
    const dateColumnId = getDateColumnId(item);
    const personColumnId = getPersonColumnId(item);
    column.items.push({
      id: item.id,
      boardId: boardData.id ? String(boardData.id) : null,
      title: item.name,
      assignee: getPersonFromItem(item, usersById, boardData.__personColumnId),
      boardName,
      groupId: item.group?.id ? String(item.group.id) : null,
      groupTitle: item.group?.title || '',
      groups: boardData.__groups || [],
      peopleOptions: boardData.__assigneeOptions || [],
      statusColumnId,
      dateColumnId,
      personColumnId,
      statusOptions,
      statusText: getStatusFromItem(item),
      statusColor: getStatusColorByText(getStatusFromItem(item), statusOptions),
      dateText: getDateFromItem(item),
      connectBoard: getConnectBoardFromItem(item),
      extraFields: buildItemExtraFields(item, columnsById),
      content: (item.column_values || [])
        .filter((cv) => {
          if (!cv.text || !cv.text.trim()) return false;
          const meta = columnsById[String(cv.id || '')];
          if (meta && meta.title && meta.title.toLowerCase().trim() === 'data') return true;
          // თუ columnების სია არ გვაქვს (demo რეჟიმი), ძველი ფილტრი – არ ვაჩვენებთ status/person/email
          if (!meta) {
            const type = (cv.type || '').toLowerCase();
            const id = String(cv.id || '').toLowerCase();
            if (type === 'status' || type === 'person' || type === 'email') return false;
            if (id === 'status' || id === 'person' || id === 'email') return false;
            return true;
          }
          return false;
        })
        .map((cv) => cv.text)
        .join(' • ') || ''
    });
  });
  return { columns: Array.from(columnsMap.values()) };
}

/**
 * Monday-დან წამოღებული ბორდის მონაცემების Kanban-ზე გადაყვანა Status-ების მიხედვით.
 * სვეტები სორტირდება STATUS_ORDER-ის მიხედვით; უცნობი status-ები ბოლოში.
 */
function transformToKanbanByStatus(boardData) {
  if (!boardData || !boardData.items_page || !boardData.items_page.items) {
    return { columns: [] };
  }
  const items = boardData.items_page.items;
  const boardName = boardData.name || '';
  const usersById = boardData.__usersById || {};
  const columnsById = boardData.__columnsById || {};
  const columnsMap = new Map();
  const orderIndex = (title) => {
    const lower = (title || '').toLowerCase().trim();
    const i = STATUS_ORDER.findIndex((s) => s.toLowerCase() === lower);
    return i >= 0 ? i : STATUS_ORDER.length;
  };
  items.forEach((item) => {
    const statusTitle = getStatusFromItem(item);
    if (!columnsMap.has(statusTitle)) {
      columnsMap.set(statusTitle, {
        id: statusTitle.replace(/\s+/g, '-').toLowerCase(),
        title: statusTitle,
        items: []
      });
    }
    const column = columnsMap.get(statusTitle);
    const statusColumnId = getStatusColumnId(item);
    const statusOptions = (boardData.__statusOptionsByColumnId || {})[String(statusColumnId || '')] || [];
    const dateColumnId = getDateColumnId(item);
    const personColumnId = getPersonColumnId(item);
    column.items.push({
      id: item.id,
      boardId: boardData.id ? String(boardData.id) : null,
      title: item.name,
      assignee: getPersonFromItem(item, usersById, boardData.__personColumnId),
      boardName,
      groupId: item.group?.id ? String(item.group.id) : null,
      groupTitle: item.group?.title || '',
      groups: boardData.__groups || [],
      peopleOptions: boardData.__assigneeOptions || [],
      statusColumnId,
      dateColumnId,
      personColumnId,
      statusOptions,
      statusText: getStatusFromItem(item),
      statusColor: getStatusColorByText(getStatusFromItem(item), statusOptions),
      dateText: getDateFromItem(item),
      connectBoard: getConnectBoardFromItem(item),
      extraFields: buildItemExtraFields(item, columnsById),
      content: (item.column_values || [])
        .filter((cv) => {
          if (!cv.text || !cv.text.trim()) return false;
          const meta = columnsById[String(cv.id || '')];
          if (meta && meta.title && meta.title.toLowerCase().trim() === 'data') return true;
          if (!meta) {
            const type = (cv.type || '').toLowerCase();
            const id = String(cv.id || '').toLowerCase();
            if (type === 'status' || type === 'person' || type === 'email') return false;
            if (id === 'status' || id === 'person' || id === 'email') return false;
            return true;
          }
          return false;
        })
        .map((cv) => cv.text)
        .join(' • ') || ''
    });
  });
  // Monday status სვეტის ყველა ლეიბლი (settings_str-იდან) ვამატებთ, თუნდაც ცარიელი იყოს.
  Object.values(boardData.__statusOptionsByColumnId || {}).forEach((options) => {
    (options || []).forEach((opt) => {
      const statusTitle = String(opt?.label || '').trim();
      if (!statusTitle) return;
      if (!columnsMap.has(statusTitle)) {
        columnsMap.set(statusTitle, {
          id: statusTitle.replace(/\s+/g, '-').toLowerCase(),
          title: statusTitle,
          headerColor: opt?.color || null,
          items: []
        });
      }
    });
  });
  const columns = Array.from(columnsMap.values()).sort(
    (a, b) => orderIndex(a.title) - orderIndex(b.title) || a.title.localeCompare(b.title)
  );
  columns.forEach((column) => {
    if (!column.headerColor) {
      const firstItemColor = (column.items || []).find((it) => it?.statusColor)?.statusColor || null;
      if (firstItemColor) column.headerColor = firstItemColor;
    }
  });
  return { columns };
}

function getDemoKanbanData() {
  return transformToKanban(MOCK_BOARD_DATA['demo-board-1']);
}

/** Monday Suggested people – ყველა account მომხმარებელი Person dropdown-ისთვის */
async function fetchAccountUsers() {
  const getPhotoUrl = (u) => {
    if (!u) return null;
    const raw = u.photo_thumb_small || u.photo_original || u.photo_small || u.avatar || null;
    if (typeof raw === 'string') return raw;
    if (raw && typeof raw === 'object' && raw.url) return raw.url;
    return null;
  };
  const users = [];
  const addUser = (u) => {
    if (!u || u.id == null) return;
    const id = String(u.id);
    if (users.some((x) => String(x.id) === id)) return;
    users.push({
      id,
      name: u.name || '',
      email: u.email || '',
      photoUrl: getPhotoUrl(u)
    });
  };
  try {
    const res = await makeRequest(GET_ALL_USERS_QUERY, {});
    (res?.users || []).forEach(addUser);
  } catch (e) {
    console.warn('[Monday API] fetchAccountUsers:', e?.message);
  }
  return users.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

const mondayService = {
  getDemoKanbanData,
  transformToKanban,
  transformToKanbanByStatus,
  getStatusFromItem,
  getPersonFromItem,
  getMondayApi,
  hasApi,
  getCurrentBoardId,
  getBoardIdsFromStorage,
  setBoardIdsToStorage,
  listenContext,
  listenBoardChanges,
  waitForMondayApi,
  fetchBoards,
  fetchBoardItems,
  fetchAccountUsers,
  updateItemDetails,
  createItem,
  deleteItem
};

export default mondayService;
