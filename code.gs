// ============================================================
// Threads 收藏機器人 vFinal - Telegram 輪詢穩定版 + Google Sheet
// 功能：
// 1. 定時從 Telegram getUpdates 取訊息
// 2. 抓 Threads 連結
// 3. Apify 抓內容
// 4. Claude 分析
// 5. 寫入 Google Sheet
// 6. 若文案暫時抓不到，自動進入補抓佇列
// 7. 自動補抓（限制次數與間隔，避免濫用 API）
//
// 欄位順序：
// 1  時間
// 2  連結
// 3  帳號
// 4  手動標籤
// 5  文案
// 6  媒體類型
// 7  瀏覽
// 8  愛心
// 9  留言
// 10 轉發
// 11 分享
// 12 主題標籤
// 13 風格分類
// 14 AI摘要
// 15 抓取狀態
// 16 重試次數
// 17 最後重試時間
// 18 備註
// ============================================================

// ========================
// 預設設定
// ========================
const DEFAULT_CONFIG = {
  DATA_SHEET_NAME: 'Threads收藏',
  ANALYSIS_LANGUAGE: '繁體中文',
  CLAUDE_MODEL: 'claude-haiku-4-5-20251001',
  TIMEZONE: 'Asia/Taipei',
  TELEGRAM_LIMIT: '20',
  MAX_RETRY: '3',
  MIN_RETRY_GAP_MINUTES: '20'
};

// ========================
// 共用工具
// ========================
function getConfig() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Config');
  if (!sheet) throw new Error('找不到 Config 工作表，請先執行 initConfigSheet()');

  const values = sheet.getDataRange().getValues();
  const config = Object.assign({}, DEFAULT_CONFIG);

  for (let i = 1; i < values.length; i++) {
    const key = String(values[i][0] || '').trim();
    const value = String(values[i][1] || '').trim();
    if (key) config[key] = value;
  }

  return config;
}

function getSpreadsheet_() {
  const config = getConfig();
  if (config.SHEET_ID) {
    return SpreadsheetApp.openById(config.SHEET_ID);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getDataSheet_() {
  const config = getConfig();
  const ss = getSpreadsheet_();
  const name = config.DATA_SHEET_NAME || DEFAULT_CONFIG.DATA_SHEET_NAME;

  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow([
      '時間', '連結', '帳號', '手動標籤', '文案', '媒體類型',
      '瀏覽', '愛心', '留言', '轉發', '分享',
      '主題標籤', '風格分類', 'AI摘要',
      '抓取狀態', '重試次數', '最後重試時間', '備註'
    ]);
  }
  return sheet;
}

function nowString_() {
  const config = getConfig();
  return Utilities.formatDate(new Date(), config.TIMEZONE || 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
}

function safeJsonParse_(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function truncate_(text, len) {
  text = String(text || '');
  if (text.length <= len) return text;
  return text.substring(0, len) + '...';
}

function getProps_() {
  return PropertiesService.getScriptProperties();
}

function isThreadsUrl_(text) {
  if (!text) return false;
  return /https?:\/\/(www\.)?threads\.(net|com)\//i.test(text);
}

function normalizeThreadsUrl_(text) {
  const match = String(text || '').match(/https?:\/\/[^\s]+/i);
  if (!match) return '';
  return match[0].split('?')[0].trim();
}

function extractAccountFromThreadsUrl_(url) {
  const match = String(url || '').match(/threads\.(net|com)\/@([A-Za-z0-9._]+)/i);
  return match ? '@' + match[2] : '';
}

function sendTelegramMessage_(token, chatId, text) {
  if (!token || !chatId || !text) return;

  const url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: String(chatId),
      text: String(text)
    }),
    muteHttpExceptions: true
  };

  const resp = UrlFetchApp.fetch(url, options);
  Logger.log('sendTelegramMessage_: ' + resp.getResponseCode() + ' / ' + resp.getContentText());
}

// 查找連結是否已存在（防重複）
function findRowByLink_(link) {
  const sheet = getDataSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const links = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
  for (let i = 0; i < links.length; i++) {
    if (String(links[i][0] || '').trim() === String(link || '').trim()) {
      return i + 2;
    }
  }
  return 0;
}

function parseMessageText_(text) {
  const lines = String(text || '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  let link = '';
  let manualTags = '';
  let views = '', likes = '', comments = '', reposts = '', shares = '';

  for (let i = 0; i < lines.length; i++) {
    if (isThreadsUrl_(lines[i])) {
      link = normalizeThreadsUrl_(lines[i]);
      break;
    }
  }

  if (!link) {
    return {
      link: '',
      manualTags: '',
      metrics: { views: '', likes: '', comments: '', reposts: '', shares: '' }
    };
  }

  const linkIndex = lines.findIndex(line => normalizeThreadsUrl_(line) === link || line.indexOf(link) >= 0);
  const rest = lines.slice(linkIndex + 1);

  if (rest.length > 0) {
    const first = rest[0];
    if (/^\d/.test(first)) {
      const nums = first.split(/[\s,，]+/);
      views = nums[0] || ''; likes = nums[1] || ''; comments = nums[2] || '';
      reposts = nums[3] || ''; shares = nums[4] || '';
    } else {
      manualTags = first;
    }
  }

  if (rest.length > 1) {
    const second = rest[1];
    if (/^\d/.test(second)) {
      const nums = second.split(/[\s,，]+/);
      views = nums[0] || views; likes = nums[1] || likes; comments = nums[2] || comments;
      reposts = nums[3] || reposts; shares = nums[4] || shares;
    }
  }

  return { link, manualTags, metrics: { views, likes, comments, reposts, shares } };
}

// ========================
// Telegram 輪詢
// ========================
function getTelegramUpdates_(offset) {
  const config = getConfig();
  if (!config.TG_TOKEN) throw new Error('TG_TOKEN 未設定');

  const params = ['timeout=0', 'limit=' + encodeURIComponent(config.TELEGRAM_LIMIT || '20')];
  if (offset !== undefined && offset !== null && offset !== '') {
    params.push('offset=' + encodeURIComponent(String(offset)));
  }

  const url = 'https://api.telegram.org/bot' + config.TG_TOKEN + '/getUpdates?' + params.join('&');
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const code = resp.getResponseCode();
  const body = resp.getContentText();

  Logger.log('getTelegramUpdates_: ' + code + ' / ' + truncate_(body, 1200));

  if (code < 200 || code >= 300) throw new Error('Telegram getUpdates 失敗，HTTP ' + code);

  const json = safeJsonParse_(body);
  if (!json || !json.ok) throw new Error('Telegram getUpdates 回傳異常：' + body);

  return json.result || [];
}

function getLastTelegramUpdateId_() {
  return getProps_().getProperty('last_update_id') || '';
}

function setLastTelegramUpdateId_(updateId) {
  getProps_().setProperty('last_update_id', String(updateId));
}

function clearLastTelegramUpdateId() {
  getProps_().deleteProperty('last_update_id');
  Logger.log('last_update_id 已清除');
}

function deleteWebhookNow() {
  const config = getConfig();
  if (!config.TG_TOKEN) throw new Error('TG_TOKEN 未設定');
  const url = 'https://api.telegram.org/bot' + config.TG_TOKEN + '/deleteWebhook?drop_pending_updates=true';
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  Logger.log(resp.getContentText());
}

// ========================
// 主流程：輪詢並處理新訊息
// ========================
function pollTelegramAndProcess() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const config = getConfig();
    const token = config.TG_TOKEN;
    const adminChatId = config.ADMIN_CHAT_ID;

    if (!token) throw new Error('TG_TOKEN 未設定');

    const lastUpdateId = getLastTelegramUpdateId_();
    const offset = lastUpdateId ? Number(lastUpdateId) + 1 : '';
    const updates = getTelegramUpdates_(offset);

    if (!updates.length) {
      Logger.log('沒有新的 Telegram 訊息');
      return;
    }

    Logger.log('收到 updates 筆數: ' + updates.length);

    for (let i = 0; i < updates.length; i++) {
      const update = updates[i];
      const updateId = update.update_id;

      try {
        processSingleTelegramUpdate_(update);
      } catch (err) {
        Logger.log('處理單筆 update 失敗: ' + err.message);
        try {
          if (token && adminChatId) {
            sendTelegramMessage_(token, adminChatId, '❌ 處理失敗：' + err.message);
          }
        } catch (e2) {
          Logger.log('回報錯誤失敗: ' + e2.message);
        }
      }

      if (updateId !== undefined && updateId !== null) {
        setLastTelegramUpdateId_(updateId);
      }
    }

  } finally {
    lock.releaseLock();
  }
}

function processSingleTelegramUpdate_(update) {
  const config = getConfig();
  const token = config.TG_TOKEN;

  const message = update.message;
  if (!message) { Logger.log('非 message 類型，略過'); return; }

  const chatId = message.chat && message.chat.id ? String(message.chat.id) : '';
  const replyChatId = config.ADMIN_CHAT_ID || chatId;
  const text = String(message.text || '').trim();

  Logger.log('chatId=' + chatId + ' text=' + truncate_(text, 300));

  if (!text) { Logger.log('空文字訊息，略過'); return; }
  if (!isThreadsUrl_(text)) { Logger.log('不是 Threads 連結，略過'); return; }

  const parsed = parseMessageText_(text);
  const link = parsed.link;
  if (!link) {
    sendTelegramMessage_(token, replyChatId, '⚠️ 找不到有效的 Threads 連結');
    return;
  }

  // 防重複存入
  const existedRow = findRowByLink_(link);
  if (existedRow) {
    Logger.log('連結已存在，略過重複存入: ' + link);
    sendTelegramMessage_(token, replyChatId, '⚠️ 這篇已經存過了');
    return;
  }

  sendTelegramMessage_(token, replyChatId, '⏳ 收到連結，處理中...');

  const manualTags = parsed.manualTags || '';
  const account = extractAccountFromThreadsUrl_(link);
  let views = parsed.metrics.views || '', likes = parsed.metrics.likes || '';
  let comments = parsed.metrics.comments || '', reposts = parsed.metrics.reposts || '';
  let shares = parsed.metrics.shares || '';

  let caption = '', mediaType = '';
  let autoViews = '', autoLikes = '', autoComments = '', autoReposts = '', autoShares = '';

  if (config.APIFY_TOKEN) {
    try {
      const apify = fetchThreadsContent_(link, config.APIFY_TOKEN);
      if (apify) {
        caption = apify.caption || ''; mediaType = apify.mediaType || '';
        autoViews = apify.views || ''; autoLikes = apify.likes || '';
        autoComments = apify.comments || ''; autoReposts = apify.reposts || '';
        autoShares = apify.shares || '';
      }
    } catch (err) {
      Logger.log('Apify 失敗: ' + err.message);
    }
  }

  const finalViews = views || autoViews, finalLikes = likes || autoLikes;
  const finalComments = comments || autoComments, finalReposts = reposts || autoReposts;
  const finalShares = shares || autoShares;

  let aiTags = '', aiStyle = '', aiSummary = '';
  if (caption && config.CLAUDE_API_KEY) {
    try {
      const analysis = analyzeWithClaude_(caption, config);
      aiTags = analysis.tags || ''; aiStyle = analysis.style || ''; aiSummary = analysis.summary || '';
    } catch (err) {
      Logger.log('Claude 分析失敗: ' + err.message);
    }
  }

  // 狀態欄位
  const status = caption ? 'completed' : 'pending_retry';
  const note = caption ? '' : '首次抓取無文案，等待自動補抓';

  const sheet = getDataSheet_();
  sheet.appendRow([
    nowString_(), link, account, manualTags, caption, mediaType,
    finalViews, finalLikes, finalComments, finalReposts, finalShares,
    aiTags, aiStyle, aiSummary,
    status, 0, '', note
  ]);

  const reply = [
    '✅ 已存入',
    '🔗 ' + link,
    account ? '👤 ' + account : '',
    caption ? '📝 ' + truncate_(caption, 60) : '📝 暫時抓不到文案，系統稍後會自動補抓'
  ].filter(Boolean).join('\n');

  sendTelegramMessage_(token, replyChatId, reply);
}

// ========================
// Apify 抓取 Threads 內容
// ========================
function fetchThreadsContent_(url, apifyToken) {
  if (!apifyToken) throw new Error('APIFY_TOKEN 未設定');

  const apiUrl =
    'https://api.apify.com/v2/acts/7xFgGDhba8W5ZvOke/run-sync-get-dataset-items' +
    '?token=' + encodeURIComponent(apifyToken) + '&timeout=50';

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ startUrls: [{ url: url }] }),
    muteHttpExceptions: true
  };

  const resp = UrlFetchApp.fetch(apiUrl, options);
  const code = resp.getResponseCode();
  const body = resp.getContentText();

  Logger.log('Apify: ' + code + ' / ' + truncate_(body, 1200));
  if (code < 200 || code >= 300) throw new Error('Apify API 錯誤，HTTP ' + code);

  const items = safeJsonParse_(body);
  if (!items || !Array.isArray(items) || items.length === 0) return null;

  const item = items[0];
  let caption = '', mediaType = '', views = '', likes = '', comments = '', reposts = '', shares = '';

  if (item.thread && typeof item.thread === 'object') {
    caption = item.thread.text || '';
    likes = String(item.thread.like_count || ''); comments = String(item.thread.reply_count || '');
    reposts = String(item.thread.repost_count || ''); shares = String(item.thread.quote_count || '');
    views = String(item.thread.view_count || ''); mediaType = item.thread.media_type || '';
  } else if (item['thread.text'] !== undefined) {
    caption = item['thread.text'] || '';
    likes = String(item['thread.like_count'] || ''); comments = String(item['thread.reply_count'] || '');
    reposts = String(item['thread.repost_count'] || ''); shares = String(item['thread.quote_count'] || '');
    views = String(item['thread.view_count'] || ''); mediaType = item['thread.media_type'] || '';
  } else if (item.text !== undefined) {
    caption = item.text || '';
    likes = String(item.like_count || ''); comments = String(item.reply_count || '');
    reposts = String(item.repost_count || ''); shares = String(item.quote_count || '');
    views = String(item.view_count || ''); mediaType = item.media_type || '';
  }

  return { caption, mediaType, views, likes, comments, reposts, shares };
}

// ========================
// Claude AI 分析
// ========================
function analyzeWithClaude_(text, config) {
  const apiKey = config.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('CLAUDE_API_KEY 未設定');
  if (!text) return { tags: '', style: '', summary: '' };

  const model = config.CLAUDE_MODEL || DEFAULT_CONFIG.CLAUDE_MODEL;
  const language = config.ANALYSIS_LANGUAGE || DEFAULT_CONFIG.ANALYSIS_LANGUAGE;

  const prompt =
`請用${language}分析以下 Threads 貼文，並且只回傳 JSON，不要多餘文字。

格式如下：
{
  "tags": "3-5個主題標籤，用逗號分隔",
  "style": "內容風格（如：教學型/故事型/觀點型/幽默型/資訊型）",
  "summary": "一句話摘要，30字以內"
}

貼文內容：
${text}`;

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: model,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    }),
    muteHttpExceptions: true
  };

  const resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
  const code = resp.getResponseCode();
  const body = resp.getContentText();

  Logger.log('Claude: ' + code + ' / ' + truncate_(body, 1200));
  if (code < 200 || code >= 300) throw new Error('Claude API 錯誤，HTTP ' + code + ' / ' + body);

  const result = safeJsonParse_(body);
  if (!result || !result.content || !result.content.length || !result.content[0].text) {
    throw new Error('Claude 回傳格式異常');
  }

  const raw = result.content[0].text;
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Claude 未回傳可解析 JSON');

  const parsed = JSON.parse(jsonMatch[0]);
  return { tags: parsed.tags || '', style: parsed.style || '', summary: parsed.summary || '' };
}

// ========================
// 自動補抓（限制次數與間隔）
// ========================
function retryPendingThreadsRows() {
  const config = getConfig();
  const sheet = getDataSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const data = sheet.getRange(2, 1, lastRow - 1, 18).getValues();
  const now = new Date();
  const maxRetry = Number(config.MAX_RETRY || 3);
  const minRetryGapMinutes = Number(config.MIN_RETRY_GAP_MINUTES || 20);
  let successCount = 0, failCount = 0;

  for (let i = 0; i < data.length; i++) {
    const rowIndex = i + 2;
    const link = String(data[i][1] || '').trim();
    const caption = String(data[i][4] || '').trim();
    const status = String(data[i][14] || '').trim();
    const retryCount = Number(data[i][15] || 0);
    const lastRetryTime = data[i][16];

    if (!link) continue;
    if (caption) continue;
    if (status !== 'pending_retry') continue;

    // 達到上限 → 標記 failed
    if (retryCount >= maxRetry) {
      sheet.getRange(rowIndex, 15).setValue('failed');
      sheet.getRange(rowIndex, 18).setValue('重試次數已達上限');
      continue;
    }

    // 間隔不足 → 跳過
    if (lastRetryTime) {
      const lastTime = new Date(lastRetryTime);
      if (!isNaN(lastTime.getTime())) {
        const diffMinutes = (now - lastTime) / 1000 / 60;
        if (diffMinutes < minRetryGapMinutes) continue;
      }
    }

    try {
      const result = fetchThreadsContent_(link, config.APIFY_TOKEN);
      const newCaption = result && result.caption ? String(result.caption).trim() : '';

      sheet.getRange(rowIndex, 16).setValue(retryCount + 1);
      sheet.getRange(rowIndex, 17).setValue(nowString_());

      if (!newCaption) {
        sheet.getRange(rowIndex, 18).setValue('補抓仍無文案');
        failCount++;
        continue;
      }

      sheet.getRange(rowIndex, 5).setValue(newCaption);
      if (result.mediaType) sheet.getRange(rowIndex, 6).setValue(result.mediaType);
      if (result.views)     sheet.getRange(rowIndex, 7).setValue(result.views);
      if (result.likes)     sheet.getRange(rowIndex, 8).setValue(result.likes);
      if (result.comments)  sheet.getRange(rowIndex, 9).setValue(result.comments);
      if (result.reposts)   sheet.getRange(rowIndex, 10).setValue(result.reposts);
      if (result.shares)    sheet.getRange(rowIndex, 11).setValue(result.shares);

      if (config.CLAUDE_API_KEY) {
        try {
          const analysis = analyzeWithClaude_(newCaption, config);
          sheet.getRange(rowIndex, 12).setValue(analysis.tags || '');
          sheet.getRange(rowIndex, 13).setValue(analysis.style || '');
          sheet.getRange(rowIndex, 14).setValue(analysis.summary || '');
        } catch (err) {
          Logger.log('Claude 補分析失敗 row ' + rowIndex + ': ' + err.message);
        }
      }

      sheet.getRange(rowIndex, 15).setValue('completed');
      sheet.getRange(rowIndex, 18).setValue('補抓成功');
      successCount++;

    } catch (err) {
      Logger.log('retryPendingThreadsRows row ' + rowIndex + ' error: ' + err.message);
      sheet.getRange(rowIndex, 16).setValue(retryCount + 1);
      sheet.getRange(rowIndex, 17).setValue(nowString_());
      sheet.getRange(rowIndex, 18).setValue('補抓錯誤: ' + truncate_(err.message, 120));
      failCount++;
    }
  }

  Logger.log('補抓完成，成功 ' + successCount + ' 筆 / 失敗 ' + failCount + ' 筆');
}

// 手動重抓指定列（rowIndex 從 2 開始）
function retryRowByNumber(rowIndex) {
  const config = getConfig();
  const sheet = getDataSheet_();

  if (rowIndex < 2) throw new Error('rowIndex 不可小於 2');

  const row = sheet.getRange(rowIndex, 1, 1, 18).getValues()[0];
  const link = String(row[1] || '').trim();
  if (!link) throw new Error('該列沒有連結');

  const result = fetchThreadsContent_(link, config.APIFY_TOKEN);
  if (!result || !result.caption) throw new Error('仍抓不到文案');

  const caption = result.caption;
  sheet.getRange(rowIndex, 5).setValue(caption);
  if (result.mediaType) sheet.getRange(rowIndex, 6).setValue(result.mediaType);
  if (result.views)     sheet.getRange(rowIndex, 7).setValue(result.views);
  if (result.likes)     sheet.getRange(rowIndex, 8).setValue(result.likes);
  if (result.comments)  sheet.getRange(rowIndex, 9).setValue(result.comments);
  if (result.reposts)   sheet.getRange(rowIndex, 10).setValue(result.reposts);
  if (result.shares)    sheet.getRange(rowIndex, 11).setValue(result.shares);

  if (config.CLAUDE_API_KEY) {
    const analysis = analyzeWithClaude_(caption, config);
    sheet.getRange(rowIndex, 12).setValue(analysis.tags || '');
    sheet.getRange(rowIndex, 13).setValue(analysis.style || '');
    sheet.getRange(rowIndex, 14).setValue(analysis.summary || '');
  }

  sheet.getRange(rowIndex, 15).setValue('completed');
  sheet.getRange(rowIndex, 18).setValue('手動重抓成功');

  Logger.log('第 ' + rowIndex + ' 列重抓完成');
}

// ========================
// 初始化 Config 工作表
// ========================
function initConfigSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Config');
  if (!sheet) sheet = ss.insertSheet('Config');

  sheet.clearContents();
  sheet.getRange('A1:B1').setValues([['KEY', 'VALUE']]);
  sheet.getRange(2, 1, 10, 2).setValues([
    ['TG_TOKEN',              '貼上 Telegram Bot Token'],
    ['CLAUDE_API_KEY',        '貼上 Claude API Key'],
    ['APIFY_TOKEN',           '貼上 Apify Token'],
    ['ADMIN_CHAT_ID',         '貼上你的 Telegram Chat ID'],
    ['SHEET_ID',              '貼上 Google Sheet ID（可空白）'],
    ['DATA_SHEET_NAME',       'Threads收藏'],
    ['ANALYSIS_LANGUAGE',     '繁體中文'],
    ['CLAUDE_MODEL',          'claude-haiku-4-5-20251001'],
    ['MAX_RETRY',             '3'],
    ['MIN_RETRY_GAP_MINUTES', '20']
  ]);

  Logger.log('Config 初始化完成');
}

// ========================
// 測試工具
// ========================
function testSendMessage() {
  const config = getConfig();
  if (!config.TG_TOKEN)      throw new Error('TG_TOKEN 未設定');
  if (!config.ADMIN_CHAT_ID) throw new Error('ADMIN_CHAT_ID 未設定');
  sendTelegramMessage_(config.TG_TOKEN, config.ADMIN_CHAT_ID, '🧪 測試訊息正常');
}

function getMyChatId() {
  const config = getConfig();
  if (!config.TG_TOKEN) throw new Error('TG_TOKEN 未設定');
  const resp = UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + config.TG_TOKEN + '/getUpdates',
    { muteHttpExceptions: true }
  );
  Logger.log(resp.getContentText());
}

function testTelegramPolling() {
  const lastUpdateId = getLastTelegramUpdateId_();
  const offset = lastUpdateId ? Number(lastUpdateId) + 1 : '';
  const updates = getTelegramUpdates_(offset);
  Logger.log(JSON.stringify(updates));
}

function testApify() {
  const config = getConfig();
  if (!config.APIFY_TOKEN) throw new Error('APIFY_TOKEN 未設定');
  const result = fetchThreadsContent_('https://www.threads.net/@zuck/post/C3c9x9KJ1Fm', config.APIFY_TOKEN);
  Logger.log(JSON.stringify(result));
}

function testClaude() {
  const config = getConfig();
  const result = analyzeWithClaude_(
    '今天想分享一個最近學到的行銷觀點，很多人以為內容只是在發廢文，其實內容是在建立信任。',
    config
  );
  Logger.log(JSON.stringify(result));
}

// ========================
// 手動分析單行 / 批次分析
// ========================
function analyzeRow(rowIndex) {
  const config = getConfig();
  const sheet = getDataSheet_();
  const caption = sheet.getRange(rowIndex, 5).getValue();
  if (!caption) return;

  const analysis = analyzeWithClaude_(caption, config);
  sheet.getRange(rowIndex, 12).setValue(analysis.tags    || '');
  sheet.getRange(rowIndex, 13).setValue(analysis.style   || '');
  sheet.getRange(rowIndex, 14).setValue(analysis.summary || '');
  Logger.log('第 ' + rowIndex + ' 行分析完成');
}

function analyzeAllRows() {
  const sheet = getDataSheet_();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][4] && !data[i][11]) {
      try {
        analyzeRow(i + 1);
        Utilities.sleep(1200);
      } catch (err) {
        Logger.log('第 ' + (i + 1) + ' 行分析失敗: ' + err.message);
      }
    }
  }
  Logger.log('批次分析完成');
}

// ========================
// 每日健康檢查
// ========================
function dailyHealthCheck() {
  const config = getConfig();
  if (!config.TG_TOKEN || !config.ADMIN_CHAT_ID) {
    throw new Error('TG_TOKEN 或 ADMIN_CHAT_ID 未設定');
  }
  sendTelegramMessage_(
    config.TG_TOKEN,
    config.ADMIN_CHAT_ID,
    '🟢 健康檢查 ' + nowString_() + ' - 輪詢穩定版正常運作'
  );
}

// ========================
// 觸發器管理
// ========================
function createPollingTriggerEvery1Min() {
  deleteTriggerByFunctionName_('pollTelegramAndProcess');
  ScriptApp.newTrigger('pollTelegramAndProcess').timeBased().everyMinutes(1).create();
  Logger.log('已建立 pollTelegramAndProcess 每 1 分鐘觸發器');
}

function createPollingTriggerEvery5Min() {
  deleteTriggerByFunctionName_('pollTelegramAndProcess');
  ScriptApp.newTrigger('pollTelegramAndProcess').timeBased().everyMinutes(5).create();
  Logger.log('已建立 pollTelegramAndProcess 每 5 分鐘觸發器');
}

function createRetryTriggerEvery30Min() {
  deleteTriggerByFunctionName_('retryPendingThreadsRows');
  ScriptApp.newTrigger('retryPendingThreadsRows').timeBased().everyMinutes(30).create();
  Logger.log('已建立 retryPendingThreadsRows 每 30 分鐘觸發器');
}

function createDailyHealthCheckTrigger() {
  deleteTriggerByFunctionName_('dailyHealthCheck');
  ScriptApp.newTrigger('dailyHealthCheck').timeBased().everyDays(1).atHour(10).create();
  Logger.log('已建立 dailyHealthCheck 每日觸發器');
}

function deleteTriggerByFunctionName_(functionName) {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

function deleteAllProjectTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) { ScriptApp.deleteTrigger(triggers[i]); }
  Logger.log('已刪除所有觸發器');
}
