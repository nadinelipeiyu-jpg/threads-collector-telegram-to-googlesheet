// ============================================================
// Threads Collector v3 - Google Apps Script
// 設定方式：在 Google Sheet 新增「⚙️設定」分頁
// A欄填 Key，B欄填 Value
// ============================================================

// ============================================================
// 讀取設定分頁
// ============================================================

function getConfig() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('⚙️設定');
  if (!sheet) {
    throw new Error('找不到「⚙️設定」分頁，請先建立設定頁');
  }
  const data = sheet.getDataRange().getValues();
  const config = {};
  data.forEach(row => {
    if (row[0] && row[1] !== undefined) {
      config[String(row[0]).trim()] = String(row[1]).trim();
    }
  });
  return config;
}

// ============================================================
// 主要處理函式：接收 Telegram 訊息
// ============================================================

function doPost(e) {
  const update = JSON.parse(e.postData.contents);
  if (!update.message) return;

  const chatId = update.message.chat.id;
  const text = update.message.text || '';

  // 判斷是否為 Threads 連結
  if (text.includes('threads.net') || text.includes('threads.com')) {
    try {
      const config = getConfig();
      const date = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm');

      // 解析輸入：第一行=連結，第二行=手動標籤，第三行=5個數字(數據)
      const lines = text.trim().split('\n');
      const link = lines[0].trim().split('?')[0]; // 去除追蹤參數

      let manualTags = '';
      let views = '', likes = '', comments = '', reposts = '', shares = '';

      if (lines.length >= 2) {
        const secondLine = lines[1].trim();
        const nums = secondLine.split(/\s+/);
        if (nums.length === 5 && nums.every(n => !isNaN(n) && n !== '')) {
          views = nums[0]; likes = nums[1]; comments = nums[2];
          reposts = nums[3]; shares = nums[4];
        } else {
          manualTags = secondLine; // 第二行永遠是手動標籤
        }
      }

      if (lines.length >= 3) {
        const thirdLine = lines[2].trim();
        const nums = thirdLine.split(/\s+/);
        if (nums.length === 5 && nums.every(n => !isNaN(n) && n !== '')) {
          views = nums[0]; likes = nums[1]; comments = nums[2];
          reposts = nums[3]; shares = nums[4];
        }
      }

      // 自動抓取資料（Apify）
      const account = extractUsername(link);
      const fetchedData = fetchThreadsContent(link, config);
      const caption = fetchedData.caption;
      const mediaType = fetchedData.mediaType;
      // 如果使用者沒有手動填數據，用 Apify 抓到的
      if (!likes && fetchedData.likeCount) likes = fetchedData.likeCount;
      if (!comments && fetchedData.replyCount) comments = fetchedData.replyCount;

      // 寫入 Google Sheet
      const dataSheetName = config['DATA_SHEET_NAME'] || '📊資料';
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let sheet = ss.getSheetByName(dataSheetName);
      if (!sheet) {
        sheet = ss.insertSheet(dataSheetName);
        sheet.appendRow(['時間', '連結', '帳號', '文案', '媒體類型', '瀏覽', '愛心', '留言', '轉發', '分享', '主題標籤', '風格分類', 'AI摘要', '手動標籤']);
      }

      const newRow = sheet.getLastRow() + 1;
      sheet.appendRow([date, link, account, caption, mediaType, views, likes, comments, reposts, shares, '', '', '', manualTags]);

      // 呼叫 Claude AI 分析（寫入 K/L/M 欄）
      if (caption) analyzeRow(newRow, caption, config);

      // 回覆確認訊息
      const captionSource = caption ? '自動抓取' : '無法抓取';
      const msg = `✅ 已存入並分析！
來源：${account}
媒體：${mediaType || '未知'}
文案來源：${captionSource}
手動標籤：${manualTags || '無'}
數據：${views ? `瀏覽${views} 愛心${likes} 留言${comments} 轉發${reposts} 分享${shares}` : `愛心${likes || '0'} 留言${comments || '0'}`}

文案：${caption ? caption.substring(0, 80) + '...' : '無（可在第二行補充文案）'}`;

      sendMessage(chatId, msg, config);

    } catch(err) {
      sendMessageRaw(chatId, `⚠️ 發生錯誤：${err.message}`);
    }
    return;
  }

  // 非 Threads 連結的預設回應
  try {
    const config = getConfig();
    sendMessage(chatId, '請直接傳 Threads 連結開始收藏 👇\nhttps://www.threads.com/...', config);
  } catch(err) {
    sendMessageRaw(chatId, '請直接傳 Threads 連結開始收藏 👇');
  }
}

// ============================================================
// AI 分析函式
// ============================================================

function analyzeRow(rowNum, caption, config) {
  const result = analyzeWithClaude(caption, config);
  if (!result) return;
  const dataSheetName = config['DATA_SHEET_NAME'] || '📊資料';
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(dataSheetName);
  if (!sheet) return;
  sheet.getRange(rowNum, 11).setValue(result.tags);
  sheet.getRange(rowNum, 12).setValue(result.style);
  sheet.getRange(rowNum, 13).setValue(result.summary);
}

// 批次補分析所有沒有標籤的舊資料（手動執行）
function analyzeAllRows() {
  const config = getConfig();
  const dataSheetName = config['DATA_SHEET_NAME'] || '📊資料';
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(dataSheetName);
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  for (let i = 2; i <= lastRow; i++) {
    const caption = sheet.getRange(i, 4).getValue();
    const existingTag = sheet.getRange(i, 11).getValue();
    if (caption && !existingTag) {
      analyzeRow(i, caption, config);
      Utilities.sleep(1000);
    }
  }
}

function analyzeWithClaude(caption, config) {
  try {
    const lang = config['ANALYSIS_LANGUAGE'] || '繁體中文';
    const prompt = `你是社群媒體分析師，請分析以下 Threads 貼文，用${lang}回覆，格式如下：

主題標籤：（2-4個標籤，用逗號分隔，例如：AI工具, 職涯建議, 創業）
風格分類：（選一個：知識型 / 故事型 / 觀點型 / 互動型 / 產品型）
AI摘要：（一句話說明這篇的核心價值，20字內）

貼文內容：
${caption}`;

    const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      headers: {
        'x-api-key': config['CLAUDE_API_KEY'],
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      payload: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }]
      }),
      muteHttpExceptions: true
    });

    const json = JSON.parse(response.getContentText());
    const text = json.content[0].text;
    const clean = (s) => (s || '').replace(/\*\*/g, '').trim();
    return {
      tags: clean(text.match(/主題標籤：(.+)/)?.[1]),
      style: clean(text.match(/風格分類：(.+)/)?.[1]),
      summary: clean(text.match(/AI摘要：(.+)/)?.[1])
    };
  } catch(e) { return null; }
}

// ============================================================
// 資料抓取函式（Apify 優先，失敗則回傳空值）
// ============================================================

function extractUsername(url) {
  const match = url.match(/threads\.(net|com)\/@([^\/\?]+)/);
  return match ? '@' + match[2] : '未知';
}

function fetchThreadsContent(url, config) {
  const apifyToken = config['APIFY_TOKEN'];

  if (apifyToken) {
    try {
      const cleanUrl = url.split('?')[0];

      const runResponse = UrlFetchApp.fetch(
        'https://api.apify.com/v2/acts/7xFgGDhba8W5ZvOke/run-sync-get-dataset-items?token=' + apifyToken + '&timeout=60',
        {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify({
            startUrls: [{ url: cleanUrl }]
          }),
          muteHttpExceptions: true
        }
      );

      const items = JSON.parse(runResponse.getContentText());

      if (items && items.length > 0) {
        const item = items[0];

        // 支援兩種格式：巢狀 { thread: { text } } 或扁平 { "thread.text": ... }
        const isFlat = item['thread.text'] !== undefined;
        const caption = isFlat ? (item['thread.text'] || '') : (item.thread && item.thread.text || '');
        const likeCount = isFlat ? (item['thread.like_count'] || '') : (item.thread && item.thread.like_count || '');
        const replyCount = isFlat ? (item['thread.reply_count'] || '') : (item.thread && item.thread.reply_count || '');
        const images = isFlat ? [] : (item.thread && item.thread.images || []);
        const videos = isFlat ? [] : (item.thread && item.thread.videos || []);

        let mediaType = '純文字';
        if (images.length > 0 && videos.length > 0) {
          mediaType = '圖片+影片';
        } else if (videos.length > 0) {
          mediaType = '影片';
        } else if (images.length > 0) {
          mediaType = '圖片';
        }

        return { caption, mediaType, likeCount, replyCount };
      }
    } catch(e) {
      Logger.log('Apify error: ' + e.message);
    }
  }

  return { caption: '', mediaType: '' };
}

// ============================================================
// Telegram 工具函式
// ============================================================

function sendMessage(chatId, text, config) {
  const token = config['TELEGRAM_TOKEN'];
  UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ chat_id: chatId, text })
  });
}

function sendMessageRaw(chatId, text) {
  Logger.log(`sendMessageRaw: chatId=${chatId}, text=${text}`);
}

// ============================================================
// 初始化：建立設定分頁範本（第一次使用時手動執行）
// ============================================================

function initSetupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('⚙️設定');
  if (sheet) {
    Logger.log('⚙️設定 分頁已存在，略過建立');
    return;
  }
  sheet = ss.insertSheet('⚙️設定');
  sheet.appendRow(['Key', 'Value', '說明']);
  sheet.appendRow(['TELEGRAM_TOKEN', '', '從 @BotFather 取得']);
  sheet.appendRow(['CLAUDE_API_KEY', '', '從 console.anthropic.com 取得']);
  sheet.appendRow(['APIFY_TOKEN', '', '從 apify.com → Settings → API & Integrations 取得']);
  sheet.appendRow(['WEBAPP_URL', '', 'Deploy → New deployment 後取得的 https://script.google.com/macros/s/.../exec 網址']);
  sheet.appendRow(['ADMIN_CHAT_ID', '', '你的 Telegram Chat ID（執行 getMyCharId 取得，用於每日健康檢查）']);
  sheet.appendRow(['DATA_SHEET_NAME', '📊資料', '資料存入的分頁名稱']);
  sheet.appendRow(['ANALYSIS_LANGUAGE', '繁體中文', 'AI分析語言']);

  sheet.getRange('A1:C1').setFontWeight('bold').setBackground('#f0f0f0');
  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(2, 300);
  sheet.setColumnWidth(3, 300);
  Logger.log('✅ ⚙️設定 分頁已建立，請填入你的 Token 和 API Key');
}

// ============================================================
// 設定 Webhook（部署後執行一次）
// ============================================================

function setWebhook() {
  const config = getConfig();
  const token = config['TELEGRAM_TOKEN'];
  const webAppUrl = config['WEBAPP_URL'];
  if (!webAppUrl) {
    Logger.log('請在 ⚙️設定 分頁填入 WEBAPP_URL');
    return;
  }
  const url = `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webAppUrl)}`;
  Logger.log(UrlFetchApp.fetch(url).getContentText());
}

// ============================================================
// Debug：直接測試 Apify 是否能抓到 Threads 內容（手動執行）
// ============================================================

function testApify() {
  const config = getConfig();
  const apifyToken = config['APIFY_TOKEN'];
  const testUrl = 'https://www.threads.com/@be.ai.curator/post/DWt7Jz7E0NO';

  Logger.log('Token: ' + (apifyToken ? apifyToken.substring(0, 10) + '...' : '❌ 找不到 token'));

  try {
    const response = UrlFetchApp.fetch(
      'https://api.apify.com/v2/acts/7xFgGDhba8W5ZvOke/run-sync-get-dataset-items?token=' + apifyToken + '&timeout=60',
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ startUrls: [{ url: testUrl }] }),
        muteHttpExceptions: true
      }
    );

    const statusCode = response.getResponseCode();
    const body = response.getContentText();
    Logger.log('Status: ' + statusCode);
    Logger.log('Response: ' + body.substring(0, 500));

  } catch(e) {
    Logger.log('Error: ' + e.message);
  }
}

// ============================================================
// 每日健康檢查（設定定時觸發器自動執行）
// ============================================================

function dailyHealthCheck() {
  try {
    const config = getConfig();
    const token = config['TELEGRAM_TOKEN'];
    const chatId = config['ADMIN_CHAT_ID'];
    if (!chatId) return;

    const now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm');
    const msg = `✅ Bot 運作正常\n時間：${now}\n如果你超過24小時沒收到這則訊息，請檢查 Bot 狀態。`;

    UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ chat_id: chatId, text: msg })
    });
  } catch(e) {
    Logger.log('Health check error: ' + e.message);
  }
}

// 取得你的 Telegram Chat ID（執行一次，看 Logger 輸出）
function getMyCharId() {
  const config = getConfig();
  const token = config['TELEGRAM_TOKEN'];
  const response = UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/getUpdates`);
  Logger.log(response.getContentText());
}
