# Threads 內容收藏系統 (Telegram Bot → Google Sheet + AI 分析)

## 系統說明

從 Threads 看到好文 → 傳連結給 Telegram Bot → 自動存入 Google Sheet + Claude AI 分析

## 架構

```
iPhone Telegram App
    ↓ 傳連結（可附關鍵字和數據）
Telegram Bot
    ↓ Webhook
Google Apps Script（免費雲端）
    ↓ 自動抓取資料 + 呼叫 Claude API
Google Sheet（14欄）
```

## Google Sheet 欄位結構

| 欄 | 名稱 | 來源 |
|----|------|------|
| A | 日期 | 自動 |
| B | 連結 | 自動（去除追蹤參數） |
| C | 來源帳號 | 自動（從URL解析） |
| D | 文案 | 自動（爬取og:description） |
| E | 圖片/影片 | 自動（偵測媒體類型） |
| F | 瀏覽數 | 手動輸入 |
| G | 愛心數 | 手動輸入 |
| H | 留言數 | 手動輸入 |
| I | 轉發數 | 手動輸入 |
| J | 分享數 | 手動輸入 |
| K | 主題標籤 | Claude AI 自動分析 |
| L | 風格分類 | Claude AI 自動分析 |
| M | AI摘要 | Claude AI 自動分析 |
| N | 手動標籤 | 使用者輸入 |

## Telegram Bot 輸入格式

```
https://www.threads.com/@username/post/xxxxx   ← 必填
職涯 AI工具                                      ← 選填：關鍵字（手動標籤）
4359 74 10 9 93                                 ← 選填：5個數字（瀏覽 愛心 留言 轉發 分享）
```

- 連結後面可直接加關鍵字（同一行用空格隔開）
- 數字要5個才算數據，否則視為關鍵字
- 全部都是可選的，只傳連結也可以

## 設定步驟

### 1. 建立 Telegram Bot
1. 搜尋 @BotFather → `/newbot`
2. 取名、取 username（需 bot 結尾）
3. 複製 Token（`數字:英數字串`）

### 2. 建立 Google Sheet
1. 新增空白試算表，命名 `Threads收藏`
2. 第一行填入 14 個欄位名稱（如上表）
3. 複製 Sheet ID（網址列中間那串）

### 3. 取得 Claude API Key
1. 登入 console.anthropic.com
2. API Keys → Create Key
3. 複製 `sk-ant-...` 開頭的 Key

### 4. 建立 Google Apps Script
1. 在 Google Sheet 點「擴充功能」→「Apps Script」
2. 全選刪除預設程式碼，貼入下方完整程式碼
3. 修改最上方三個常數：TELEGRAM_TOKEN、SHEET_ID、CLAUDE_API_KEY
4. 存檔

### 5. 部署
1. 「部署」→「新增部署作業」
2. 類型選「網頁應用程式」
3. 執行身分：「我」；誰可以存取：「所有人」
4. 部署 → 授權 → 複製網址

### 6. 設定 Webhook
1. 把程式碼中 `setWebhook` 函式的 `YOUR_WEBAPP_URL` 換成部署網址
2. 存檔 → 選 `setWebhook` 函式 → 執行
3. Log 出現 `"ok":true` 即成功

### 7. 驗證
在瀏覽器開：`https://api.telegram.org/bot{TOKEN}/getWebhookInfo`
確認 `url` 有值且沒有 `last_error_message`

## 完整 Apps Script 程式碼

```javascript
const TELEGRAM_TOKEN = 'YOUR_TELEGRAM_TOKEN';
const SHEET_ID = 'YOUR_SHEET_ID';
const CLAUDE_API_KEY = 'YOUR_CLAUDE_API_KEY';

function doPost(e) {
  const update = JSON.parse(e.postData.contents);
  if (!update.message) return;

  const chatId = update.message.chat.id;
  const text = update.message.text || '';

  if (text.includes('threads.net') || text.includes('threads.com')) {
    const date = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm');

    // 解析輸入：連結、關鍵字、數據分開處理
    const lines = text.trim().split('\n');
    const urlLine = lines[0].trim().split(/\s+/);
    const link = urlLine[0].split('?')[0]; // 去除追蹤參數
    const inlineKeywords = urlLine.slice(1).join(', ');

    let manualTags = inlineKeywords;
    let views = '', likes = '', comments = '', reposts = '', shares = '';

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      const nums = line.split(/\s+/);
      if (nums.length === 5 && nums.every(n => !isNaN(n) && n !== '')) {
        views = nums[0]; likes = nums[1]; comments = nums[2];
        reposts = nums[3]; shares = nums[4];
      } else if (line) {
        manualTags += (manualTags ? ', ' : '') + line;
      }
    }

    const account = extractUsername(link);
    const caption = fetchCaption(link);
    const mediaType = detectMediaType(link);

    const sheet = SpreadsheetApp.openById(SHEET_ID).getActiveSheet();
    const newRow = sheet.getLastRow() + 1;
    sheet.appendRow([date, link, account, caption, mediaType, views, likes, comments, reposts, shares, '', '', '', manualTags]);

    if (caption) analyzeRow(newRow, caption);

    const msg = `✅ 已存入並分析！
來源：${account}
媒體：${mediaType}
手動標籤：${manualTags || '無'}
數據：${views ? `瀏覽${views} 愛心${likes} 留言${comments} 轉發${reposts} 分享${shares}` : '無'}

文案：${caption ? caption.substring(0, 80) + '...' : '無法抓取'}`;

    sendMessage(chatId, msg);
    return;
  }

  sendMessage(chatId, '請直接傳 Threads 連結開始收藏 👇\nhttps://www.threads.com/...');
}

function analyzeRow(rowNum, caption) {
  const result = analyzeWithClaude(caption);
  if (!result) return;
  const sheet = SpreadsheetApp.openById(SHEET_ID).getActiveSheet();
  sheet.getRange(rowNum, 11).setValue(result.tags);
  sheet.getRange(rowNum, 12).setValue(result.style);
  sheet.getRange(rowNum, 13).setValue(result.summary);
}

function analyzeAllRows() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getActiveSheet();
  const lastRow = sheet.getLastRow();
  for (let i = 2; i <= lastRow; i++) {
    const caption = sheet.getRange(i, 4).getValue();
    const existingTag = sheet.getRange(i, 11).getValue();
    if (caption && !existingTag) {
      analyzeRow(i, caption);
      Utilities.sleep(1000);
    }
  }
}

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

function extractUsername(url) {
  const match = url.match(/threads\.(net|com)\/@([^\/\?]+)/);
  return match ? '@' + match[2] : '未知';
}

function fetchCaption(url) {
  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const html = response.getContentText();
    const match = html.match(/<meta property="og:description" content="([^"]+)"/);
    return match ? decodeHtml(match[1]) : '';
  } catch(e) { return ''; }
}

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

function decodeHtml(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function sendMessage(chatId, text) {
  UrlFetchApp.fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ chat_id: chatId, text })
  });
}

function setWebhook() {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook?url=YOUR_WEBAPP_URL`;
  Logger.log(UrlFetchApp.fetch(url).getContentText());
}
```

## 已知限制

- 影片數/圖片數無法自動抓取（Threads 動態載入）
- 其他帳號的數據（瀏覽、愛心等）無法自動爬取
- 文案抓取成功率約 70-80%，依 Threads 頁面結構而定

## 批次補分析舊資料

在 Apps Script 選 `analyzeAllRows` 函式執行，會自動補齊所有空白的 K/L/M 欄。

## 延伸方向

- 定期讓 Claude 從 Sheet 歸納爆文規律
- 加仿寫功能：傳連結 → Bot 產出類似風格草稿
- 串接 Notion 建立內容知識庫
