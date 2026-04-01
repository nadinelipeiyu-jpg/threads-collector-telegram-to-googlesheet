// ============================================================
// Threads Collector - Google Apps Script
// 使用前請修改下方三個變數
// ============================================================

const TELEGRAM_TOKEN = 'YOUR_TELEGRAM_TOKEN';   // 從 @BotFather 取得
const SHEET_ID = 'YOUR_SHEET_ID';               // Google Sheet 網址中間那串
const CLAUDE_API_KEY = 'YOUR_CLAUDE_API_KEY';   // 從 console.anthropic.com 取得

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
    const date = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm');

    // 解析輸入：第一行=連結(+關鍵字)，第二行=標籤，第三行=5個數字(數據)
    const lines = text.trim().split('\n');
    const urlLine = lines[0].trim().split(/\s+/);
    const link = urlLine[0].split('?')[0]; // 去除 xmt= 等追蹤參數
    const inlineKeywords = urlLine.slice(1).join(', ');

    let manualTags = inlineKeywords;
    let views = '', likes = '', comments = '', reposts = '', shares = '';

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      const nums = line.split(/\s+/);
      // 剛好 5 個數字才視為數據，否則視為標籤
      if (nums.length === 5 && nums.every(n => !isNaN(n) && n !== '')) {
        views = nums[0]; likes = nums[1]; comments = nums[2];
        reposts = nums[3]; shares = nums[4];
      } else if (line) {
        manualTags += (manualTags ? ', ' : '') + line;
      }
    }

    // 自動抓取資料
    const account = extractUsername(link);
    const caption = fetchCaption(link);
    const mediaType = detectMediaType(link);

    // 寫入 Google Sheet
    const sheet = SpreadsheetApp.openById(SHEET_ID).getActiveSheet();
    const newRow = sheet.getLastRow() + 1;
    sheet.appendRow([date, link, account, caption, mediaType, views, likes, comments, reposts, shares, '', '', '', manualTags]);

    // 呼叫 Claude AI 分析（寫入 K/L/M 欄）
    if (caption) analyzeRow(newRow, caption);

    // 回覆確認訊息
    const msg = `✅ 已存入並分析！
來源：${account}
媒體：${mediaType}
手動標籤：${manualTags || '無'}
數據：${views ? `瀏覽${views} 愛心${likes} 留言${comments} 轉發${reposts} 分享${shares}` : '無'}

文案：${caption ? caption.substring(0, 80) + '...' : '無法抓取'}`;

    sendMessage(chatId, msg);
    return;
  }

  // 非 Threads 連結的預設回應
  sendMessage(chatId, '請直接傳 Threads 連結開始收藏 👇\nhttps://www.threads.com/...');
}

// ============================================================
// AI 分析函式
// ============================================================

// 分析單筆資料並寫入 K/L/M 欄
function analyzeRow(rowNum, caption) {
  const result = analyzeWithClaude(caption);
  if (!result) return;
  const sheet = SpreadsheetApp.openById(SHEET_ID).getActiveSheet();
  sheet.getRange(rowNum, 11).setValue(result.tags);    // K欄：主題標籤
  sheet.getRange(rowNum, 12).setValue(result.style);   // L欄：風格分類
  sheet.getRange(rowNum, 13).setValue(result.summary); // M欄：AI摘要
}

// 批次補分析所有沒有標籤的舊資料（手動執行）
function analyzeAllRows() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getActiveSheet();
  const lastRow = sheet.getLastRow();
  for (let i = 2; i <= lastRow; i++) {
    const caption = sheet.getRange(i, 4).getValue();      // D欄：文案
    const existingTag = sheet.getRange(i, 11).getValue(); // K欄：主題標籤
    if (caption && !existingTag) {
      analyzeRow(i, caption);
      Utilities.sleep(1000); // 避免 API 呼叫過快
    }
  }
}

// 呼叫 Claude API 進行分析
function analyzeWithClaude(caption) {
  try {
    const prompt = `你是社群媒體分析師，請分析以下 Threads 貼文，用繁體中文回覆，格式如下：

主題標籤：（2-4個標籤，用逗號分隔，例如：AI工具, 職涯建議, 創業）
風格分類：（選一個：知識型 / 故事型 / 觀點型 / 互動型 / 產品型）
AI摘要：（一句話說明這篇的核心價值，20字內）

貼文內容：
${caption}`;

    const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      headers: {
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      payload: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // 使用 Haiku 節省費用
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }]
      }),
      muteHttpExceptions: true
    });

    const json = JSON.parse(response.getContentText());
    const text = json.content[0].text;

    // 去除 Markdown 粗體符號 **
    const clean = (s) => (s || '').replace(/\*\*/g, '').trim();
    return {
      tags: clean(text.match(/主題標籤：(.+)/)?.[1]),
      style: clean(text.match(/風格分類：(.+)/)?.[1]),
      summary: clean(text.match(/AI摘要：(.+)/)?.[1])
    };
  } catch(e) { return null; }
}

// ============================================================
// 資料抓取函式
// ============================================================

// 從 URL 解析 @username
function extractUsername(url) {
  const match = url.match(/threads\.(net|com)\/@([^\/\?]+)/);
  return match ? '@' + match[2] : '未知';
}

// 爬取 og:description 作為文案（支援 emoji 和中文）
function fetchCaption(url) {
  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const html = response.getContentText();
    const match = html.match(/<meta property="og:description" content="([^"]+)"/);
    return match ? decodeHtml(match[1]) : '';
  } catch(e) { return ''; }
}

// 偵測媒體類型（圖片 / 影片 / 圖片+影片 / 純文字）
function detectMediaType(url) {
  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const html = response.getContentText();
    const hasVideo = html.includes('og:video') || html.includes('video/mp4') ||
                     html.includes('og:video:secure_url') || html.includes('twitter:player') ||
                     html.includes('"contentUrl"');
    const hasImage = html.includes('og:image');
    if (hasVideo && hasImage) return '圖片+影片';
    if (hasVideo) return '影片';
    if (hasImage) return '圖片';
    return '純文字';
  } catch(e) { return ''; }
}

// 解碼 HTML 實體（包含 emoji）
function decodeHtml(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

// ============================================================
// Telegram 工具函式
// ============================================================

// 傳送訊息給使用者
function sendMessage(chatId, text) {
  UrlFetchApp.fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ chat_id: chatId, text })
  });
}

// 設定 Webhook（部署後執行一次）
// 將 YOUR_WEBAPP_URL 換成部署後取得的網址
function setWebhook() {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook?url=YOUR_WEBAPP_URL`;
  Logger.log(UrlFetchApp.fetch(url).getContentText());
}
