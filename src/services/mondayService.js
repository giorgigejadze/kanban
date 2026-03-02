import axios from 'axios';
import mondaySdk from 'monday-sdk-js';

const MONDAY_API_URL = 'https://api.monday.com/v2';
const API_KEY = process.env.REACT_APP_MONDAY_API_KEY || '';
const API_PROXY_URL = (process.env.REACT_APP_API_URL || '').replace(/\/$/, '');

const GET_BOARDS_QUERY = `
  query {
    boards(limit: 10) {
      id
      name
    }
  }
`;

const GET_BOARD_ITEMS_QUERY = `
  query GetBoardItems($boardId: [ID!]) {
    boards(ids: $boardId) {
      id
      name
      columns {
        id
        title
        type
        settings_str
      }
      groups { id title }
      items_page(limit: 100) {
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

async function fetchBoards() {
  const data = await makeRequest(GET_BOARDS_QUERY);
  const boards = (data && data.boards) || (data && Array.isArray(data) ? data : null);
  console.log('[Monday API] ბორდების მონაცემები:', boards || data);
  if (!boards || !boards.length) throw new Error('ბორდები არ მოიძებნა');
  return boards;
}

async function fetchBoardItems(boardId) {
  const data = await makeRequest(GET_BOARD_ITEMS_QUERY, { boardId: [boardId] });
  const boards = (data && data.boards) || (Array.isArray(data) ? data : null);
  if (!boards || !boards.length) throw new Error('ბორდი არ მოიძებნა');
  const board = boards[0];
  // Column ID -> title/type map, რომ შევძლოთ მხოლოდ "Data" სვეტის გამოყვანა
  if (Array.isArray(board.columns)) {
    const columnsById = {};
    board.columns.forEach((col) => {
      if (!col || !col.id) return;
      columnsById[String(col.id)] = {
        id: String(col.id),
        title: col.title || '',
        type: col.type || ''
      };
    });
    board.__columnsById = columnsById;
    board.__statusOptionsByColumnId = buildStatusOptionsByColumnId(board);
  }
  board.__groups = Array.isArray(board.groups) ? board.groups.map((g) => ({ id: String(g.id), title: g.title || '' })) : [];
  board.__usersById = board.__usersById || {};
  if (!board.items_page && Array.isArray(board.items)) board.items_page = { items: board.items };
  if (!board.items_page || !board.items_page.items) board.items_page = { items: [] };
  try {
    const items = board.items_page.items || [];
    const userIds = Array.from(new Set(
      items
        .flatMap((item) => (item.column_values || []))
        .filter((cv) => (cv.type && cv.type.toLowerCase() === 'person') || (cv.id && String(cv.id).toLowerCase() === 'person'))
        .flatMap((cv) => {
          if (!cv.value) return [];
          try {
            const parsed = JSON.parse(cv.value);
            const arr = parsed?.personsAndTeams || parsed?.persons || [];
            return arr
              .filter((x) => x && typeof x.id === 'number')
              .map((x) => x.id);
          } catch (e) {
            return [];
          }
        })
    ));
    if (userIds.length) {
      const usersData = await makeRequest(GET_USERS_QUERY, { ids: userIds });
      const users = usersData?.users || [];
      const usersById = {};
      users.forEach((u) => {
        if (!u || u.id == null) return;
        usersById[String(u.id)] = {
          id: String(u.id),
          name: u.name || '',
          email: u.email || '',
          photoUrl: u.photo_thumb_small || u.photo_original || null
        };
      });
      board.__usersById = usersById;
      board.__assigneeOptions = Object.values(usersById).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
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

/** item-იდან Person სვეტის მნიშვნელობა (პერსონის სახელი + ავატარი, თუ გვაქვს usersById) */
function getPersonFromItem(item, usersById = {}) {
  const col = (item.column_values || []).find(
    (cv) => (cv.type && cv.type.toLowerCase() === 'person') || (cv.id && String(cv.id).toLowerCase() === 'person')
  );
  const fallbackName = (col && col.text && col.text.trim()) ? col.text.trim() : null;

  let personId = null;
  if (col && col.value) {
    try {
      const parsed = JSON.parse(col.value);
      const arr = parsed?.personsAndTeams || parsed?.persons || [];
      const first = Array.isArray(arr) ? arr.find((x) => x && typeof x.id === 'number') : null;
      if (first && typeof first.id === 'number') {
        personId = String(first.id);
      }
    } catch (e) {
      // value ვერ დაიპარსა – გავაგრძელოთ მხოლოდ სახელით
    }
  }

  const user = personId ? usersById[personId] : null;
  if (!user && !fallbackName) return null;

  return {
    id: user?.id || personId || null,
    name: user?.name || fallbackName,
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
      if (!field.value) return false;
      if (field.type === 'status' || field.type === 'person' || field.type === 'date') return false;
      const lowId = field.id.toLowerCase();
      if (lowId === 'status' || lowId === 'person' || lowId === 'date') return false;
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
  return getColumnValueByType(item, 'person')?.id || null;
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
      assignee: getPersonFromItem(item, usersById),
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
      assignee: getPersonFromItem(item, usersById),
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

const mondayService = {
  getDemoKanbanData,
  transformToKanban,
  transformToKanbanByStatus,
  getStatusFromItem,
  getPersonFromItem,
  getMondayApi,
  hasApi,
  getCurrentBoardId,
  listenContext,
  listenBoardChanges,
  waitForMondayApi,
  fetchBoards,
  fetchBoardItems,
  updateItemDetails
};

export default mondayService;
