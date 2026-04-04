// ============================================================
// Threads 收藏機器人 v3 - Google Apps Script
// 欄位順序：時間/連結/帳號/手動標籤/文案/媒體類型/瀏覽/愛心/留言/轉發/分享/主題標籤/風格分類/AI摘要
// ============================================================

function getConfig() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Config');
  if (!sheet) throw new Error('找不到 Config 工作表，請先執行 initSetupSheet()');
  const data = sheet.getDataRange().getValues();
  const config = {};
  data.forEach(row => { if (row[0]) config[row[0]] = row[1]; });
  return config;
}

function sendMessage(token, chatId, text) {
  const url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ chat_id: String(chatId), text: text }),
    muteHttpExceptions: true
  };
  try {
    const resp = UrlFetchApp.fetch(url, options);
    Logger.log('sendMessage 回應: ' + resp.getContentText());
  } catch (err) {
    Logger.log('sendMessage 失敗: ' + err.message);
  }
}

function doPost(e) {
  Logger.log('doPost 被呼叫');

  let update;
  try {
    update = JSON.parse(e.postData.contents);
  } catch (err) {
    Logger.log('JSON 解析失敗: ' + err.message);
    return ContentService.createTextOutput('ok');
  }

  Logger.log('update: ' + JSON.stringify(update).substring(0, 500));

  if (!update.message) {
    Logger.log('非一般訊息，略過');
    return ContentService.createTextOutput('ok');
  }

  // 防止 Telegram 重試導致重複處理
  const updateId = String(update.update_id);
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('last_update_id') === updateId) {
    Logger.log('重複的 update_id，略過: ' + updateId);
    return ContentService.createTextOutput('ok');
  }
  props.setProperty('last_update_id', updateId);

  const chatId = update.message.chat.id;
  const text = update.message.text || '';
  Logger.log('chatId: ' + chatId + ' | text: ' + text.substring(0, 100));

  let config;
  try {
    config = getConfig();
  } catch (err) {
    Logger.log('getConfig 失敗: ' + err.message);
    return ContentService.createTextOutput('ok');
  }

  const token = config['TELEGRAM_TOKEN'];
  const adminChatId = config['ADMIN_CHAT_ID'] || chatId; // 優先用 Config 裡的 ID

  if (!token) {
    Logger.log('TELEGRAM_TOKEN 未設定');
    return ContentService.createTextOutput('ok');
  }

  if (!text.includes('threads.net') && !text.includes('threads.com')) {
    Logger.log('非 Threads 連結，略過');
    return ContentService.createTextOutput('ok');
  }

  // 先送確認讓使用者知道 bot 在處理
  sendMessage(token, adminChatId, '⏳ 收到連結，處理中...');

  try {
    const date = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm');

    const lines = text.trim().split('\n');
    const link = lines[0].trim().split('?')[0];

    // 從 URL 抽取帳號
    const accountMatch = link.match(/threads\.(net|com)\/@([\w.]+)/);
    const account = accountMatch ? '@' + accountMatch[2] : '';

    // 第二行：手動標籤（文字開頭）或數字資料
    let manualTags = '';
    let views = '', likes = '', comments = '', reposts = '', shares = '';

    if (lines.length > 1) {
      const second = lines[1].trim();
      if (/^\d/.test(second)) {
        const nums = second.split(/[\s,，]+/);
        views    = nums[0] || '';
        likes    = nums[1] || '';
        comments = nums[2] || '';
        reposts  = nums[3] || '';
        shares   = nums[4] || '';
      } else {
        manualTags = second;
      }
    }

    if (lines.length > 2) {
      const third = lines[2].trim();
      const nums = third.split(/[\s,，]+/);
      views    = nums[0] || '';
      likes    = nums[1] || '';
      comments = nums[2] || '';
      reposts  = nums[3] || '';
      shares   = nums[4] || '';
    }

    // Apify 抓取內容
    let caption = '', mediaType = '';
    let autoViews = '', autoLikes = '', autoComments = '', autoReposts = '', autoShares = '';

    const apifyToken = config['APIFY_TOKEN'];
    if (apifyToken) {
      Logger.log('呼叫 Apify...');
      const result = fetchThreadsContent(link, apifyToken);
      if (result) {
        caption      = result.caption   || '';
        mediaType    = result.mediaType || '';
        autoViews    = result.views     || '';
        autoLikes    = result.likes     || '';
        autoComments = result.comments  || '';
        autoReposts  = result.reposts   || '';
        autoShares   = result.shares    || '';
        Logger.log('Apify 成功，caption 長度: ' + caption.length);
      } else {
        Logger.log('Apify 回傳空結果');
      }
    }

    const finalViews    = views    || autoViews;
    const finalLikes    = likes    || autoLikes;
    const finalComments = comments || autoComments;
    const finalReposts  = reposts  || autoReposts;
    const finalShares   = shares   || autoShares;

    // Claude AI 分析
    let aiTags = '', aiStyle = '', aiSummary = '';
    if (caption) {
      const analysis = analyzeWithClaude(caption, config);
      aiTags    = analysis.tags    || '';
      aiStyle   = analysis.style   || '';
      aiSummary = analysis.summary || '';
    }

    // 寫入 Sheet
    const dataSheetName = config['DATA_SHEET_NAME'] || 'Threads收藏';
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(dataSheetName);
    if (!sheet) {
      sheet = ss.insertSheet(dataSheetName);
      sheet.appendRow(['時間','連結','帳號','手動標籤','文案','媒體類型','瀏覽','愛心','留言','轉發','分享','主題標籤','風格分類','AI摘要']);
    }

    sheet.appendRow([
      date, link, account, manualTags, caption, mediaType,
      finalViews, finalLikes, finalComments, finalReposts, finalShares,
      aiTags, aiStyle, aiSummary
    ]);

    Logger.log('寫入 Sheet 成功');

    const replyText = '✅ 已存入！\n🔗 ' + link + '\n👤 ' + account + '\n📝 ' + (caption ? caption.substring(0, 60) + '...' : '無法抓取內文');
    sendMessage(token, adminChatId, replyText);
    Logger.log('回覆訊息已送出');

  } catch (err) {
    Logger.log('doPost 錯誤: ' + err.message);
    sendMessage(token, adminChatId, '❌ 發生錯誤：' + err.message);
  }

  return ContentService.createTextOutput('ok');
}

// ============================================================
// Apify 抓取 Threads 內容
// ============================================================
function fetchThreadsContent(url, apifyToken) {
  const apiUrl = 'https://api.apify.com/v2/acts/7xFgGDhba8W5ZvOke/run-sync-get-dataset-items?token=' + apifyToken + '&timeout=55';
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ startUrls: [{ url: url }] }),
    muteHttpExceptions: true
  };
  try {
    const resp = UrlFetchApp.fetch(apiUrl, options);
    const items = JSON.parse(resp.getContentText());
    Logger.log('Apify 筆數: ' + items.length);
    if (!items || items.length === 0) return null;

    const item = items[0];
    let caption = '', mediaType = '', views = '', likes = '', comments = '', reposts = '', shares = '';

    if (item.thread && item.thread.text !== undefined) {
      // Nested 格式
      caption   = item.thread.text           || '';
      likes     = String(item.thread.like_count    || '');
      comments  = String(item.thread.reply_count   || '');
      reposts   = String(item.thread.repost_count  || '');
      shares    = String(item.thread.quote_count   || '');
      views     = String(item.thread.view_count    || '');
      mediaType = item.thread.media_type           || '';
    } else if (item['thread.text'] !== undefined) {
      // Flat 格式
      caption   = item['thread.text']              || '';
      likes     = String(item['thread.like_count']    || '');
      comments  = String(item['thread.reply_count']   || '');
      reposts   = String(item['thread.repost_count']  || '');
      shares    = String(item['thread.quote_count']   || '');
      views     = String(item['thread.view_count']    || '');
      mediaType = item['thread.media_type']           || '';
    } else if (item.text !== undefined) {
      caption   = item.text           || '';
      likes     = String(item.like_count    || '');
      comments  = String(item.reply_count   || '');
      reposts   = String(item.repost_count  || '');
      shares    = String(item.quote_count   || '');
      views     = String(item.view_count    || '');
      mediaType = item.media_type           || '';
    }

    return { caption, mediaType, views, likes, comments, reposts, shares };
  } catch (err) {
    Logger.log('Apify 錯誤: ' + err.message);
    return null;
  }
}

// ============================================================
// Claude AI 分析
// ============================================================
function analyzeWithClaude(text, config) {
  const apiKey = config['CLAUDE_API_KEY'];
  if (!apiKey || !text) return { tags: '', style: '', summary: '' };
  const language = config['ANALYSIS_LANGUAGE'] || '繁體中文';
  const prompt = `請用${language}分析以下 Threads 貼文，回傳 JSON 格式：
{"tags": "3-5個主題標籤，用逗號分隔", "style": "內容風格（如：教學型/故事型/觀點型/幽默型/資訊型）", "summary": "一句話摘要，30字以內"}

貼文內容：
${text}`;
  const options = {
    method: 'post',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    payload: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    }),
    muteHttpExceptions: true
  };
  try {
    const resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
    const result = JSON.parse(resp.getContentText());
    const raw = result.content[0].text;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (err) {
    Logger.log('Claude 錯誤: ' + err.message);
  }
  return { tags: '', style: '', summary: '' };
}

// ============================================================
// 手動分析單行（欄位：文案=5, 主題標籤=12, 風格分類=13, AI摘要=14）
// ============================================================
function analyzeRow(rowIndex) {
  const config = getConfig();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(config['DATA_SHEET_NAME'] || 'Threads收藏');
  if (!sheet) return;
  const caption = sheet.getRange(rowIndex, 5).getValue(); // 文案在第5欄
  if (!caption) return;
  const analysis = analyzeWithClaude(caption, config);
  sheet.getRange(rowIndex, 12).setValue(analysis.tags    || ''); // 主題標籤
  sheet.getRange(rowIndex, 13).setValue(analysis.style   || ''); // 風格分類
  sheet.getRange(rowIndex, 14).setValue(analysis.summary || ''); // AI摘要
  Logger.log('第 ' + rowIndex + ' 行分析完成');
}

// ============================================================
// 批次分析所有未分析的行
// ============================================================
function analyzeAllRows() {
  const config = getConfig();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(config['DATA_SHEET_NAME'] || 'Threads收藏');
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][4] && !data[i][11]) { // 有文案(col5)但沒有主題標籤(col12)
      analyzeRow(i + 1);
      Utilities.sleep(1000);
    }
  }
  Logger.log('批次分析完成');
}

// ============================================================
// 初始化 Config 工作表
// ============================================================
function initSetupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Config');
  if (!sheet) sheet = ss.insertSheet('Config');
  sheet.clearContents();
  sheet.getRange('A1:B1').setValues([['KEY', 'VALUE']]);
  sheet.getRange(2, 1, 7, 2).setValues([
    ['TELEGRAM_TOKEN', '你的 Telegram Bot Token'],
    ['CLAUDE_API_KEY', '你的 Claude API Key'],
    ['APIFY_TOKEN',    '你的 Apify Token'],
    ['WEBAPP_URL',     '部署後的網址'],
    ['ADMIN_CHAT_ID',  '你的 Telegram Chat ID'],
    ['DATA_SHEET_NAME','Threads收藏'],
    ['ANALYSIS_LANGUAGE', '繁體中文']
  ]);
  Logger.log('Config 初始化完成');
}

// ============================================================
// 設定 Webhook
// ============================================================
function setWebhook() {
  const config = getConfig();
  const resp = UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + config['TELEGRAM_TOKEN'] + '/setWebhook?url=' + config['WEBAPP_URL']
  );
  Logger.log('setWebhook: ' + resp.getContentText());
}

// ============================================================
// 測試用函式
// ============================================================
function testSendMessage() {
  const config = getConfig();
  sendMessage(config['TELEGRAM_TOKEN'], config['ADMIN_CHAT_ID'], '🧪 測試訊息正常');
}

function testApify() {
  const config = getConfig();
  const result = fetchThreadsContent('https://www.threads.net/@zuck/post/C3c9x9KJ1Fm', config['APIFY_TOKEN']);
  Logger.log('testApify: ' + JSON.stringify(result));
}

function getMyCharId() {
  const config = getConfig();
  const resp = UrlFetchApp.fetch('https://api.telegram.org/bot' + config['TELEGRAM_TOKEN'] + '/getUpdates');
  Logger.log(resp.getContentText());
}

// ============================================================
// 每日健康檢查（需設定時間觸發器）
// ============================================================
function dailyHealthCheck() {
  const config = getConfig();
  const now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm');
  sendMessage(config['TELEGRAM_TOKEN'], config['ADMIN_CHAT_ID'], '🟢 健康檢查 ' + now + ' - 正常運作');
}
