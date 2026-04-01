# Threads Collector

用 Telegram Bot 收藏 Threads 好文，自動存入 Google Sheet，並由 Claude AI 自動分析分類。

---

## 功能

- 傳 Threads 連結給 Bot → 自動存入 Google Sheet
- 自動抓取：日期、來源帳號、文案、媒體類型
- Claude AI 自動分析：主題標籤、風格分類、AI摘要
- 支援手動附加關鍵字和數據
- 兩支手機同一帳號都能用

---

## 系統架構

```
iPhone Telegram App
    ↓ 傳連結（可附關鍵字和數據）
Telegram Bot
    ↓ Webhook
Google Apps Script（免費雲端）
    ↓ 自動抓取資料 + 呼叫 Claude API
Google Sheet（14欄）
```

---

## 準備事項

| 項目 | 說明 | 費用 |
|------|------|------|
| Telegram 帳號 | 傳訊息的介面 | 免費 |
| Google 帳號 | Google Sheet + Apps Script | 免費 |
| Claude API Key | AI 分析用 | 有免費額度 |

---

## Google Sheet 欄位

| 欄 | 名稱 | 來源 |
|----|------|------|
| A | 日期 | 自動 |
| B | 連結 | 自動（已去除追蹤參數） |
| C | 來源帳號 | 自動（從 URL 解析） |
| D | 文案 | 自動（爬取頁面內容） |
| E | 媒體類型 | 自動（圖片/影片/純文字） |
| F | 瀏覽數 | 手動輸入 |
| G | 愛心數 | 手動輸入 |
| H | 留言數 | 手動輸入 |
| I | 轉發數 | 手動輸入 |
| J | 分享數 | 手動輸入 |
| K | 主題標籤 | Claude AI 自動 |
| L | 風格分類 | Claude AI 自動 |
| M | AI摘要 | Claude AI 自動 |
| N | 手動標籤 | 使用者輸入 |

---

## 安裝步驟

### 第一步：建立 Telegram Bot

1. 打開 Telegram，搜尋 **@BotFather**
2. 發送 `/newbot`
3. 輸入 Bot 名稱和 username（username 需以 `bot` 結尾）
4. 複製取得的 Token（格式：`123456789:AAFxxxxx`）

### 第二步：建立 Google Sheet

1. 建立新的 Google 試算表
2. 第一列填入以下 14 個欄位名稱：
   ```
   日期 | 連結 | 來源帳號 | 文案 | 媒體類型 | 瀏覽數 | 愛心數 | 留言數 | 轉發數 | 分享數 | 主題標籤 | 風格分類 | AI摘要 | 手動標籤
   ```
3. 從網址列複製 Sheet ID（網址中 `/d/` 和 `/edit` 之間的字串）

### 第三步：取得 Claude API Key

1. 前往 [console.anthropic.com](https://console.anthropic.com)
2. 點選左側 **API Keys** → **Create Key**
3. 複製 `sk-ant-` 開頭的 Key

### 第四步：建立 Google Apps Script

1. 在 Google Sheet 點選上方選單「**擴充功能**」→「**Apps Script**」
2. 刪除預設程式碼，貼入 `code.gs` 的完整內容
3. 修改最上方三個變數：

```javascript
const TELEGRAM_TOKEN = '貼上你的 Telegram Token';
const SHEET_ID = '貼上你的 Sheet ID';
const CLAUDE_API_KEY = '貼上你的 Claude API Key';
```

4. 存檔（Cmd+S）

### 第五步：部署為網頁應用程式

1. 點選右上角「**部署**」→「**新增部署作業**」
2. 點選齒輪圖示，選擇「**網頁應用程式**」
3. 設定：
   - 執行身分：**我**
   - 誰可以存取：**所有人**
4. 點選「**部署**」，完成 Google 授權流程
5. 複製產生的網址（格式：`https://script.google.com/macros/s/xxx/exec`）

### 第六步：設定 Webhook

1. 回到 Apps Script 編輯器
2. 找到 `setWebhook` 函式，將 `YOUR_WEBAPP_URL` 換成第五步複製的網址：

```javascript
function setWebhook() {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook?url=你的部署網址`;
  Logger.log(UrlFetchApp.fetch(url).getContentText());
}
```

3. 存檔，選擇 `setWebhook` 函式後點「**執行**」
4. 下方 Log 出現 `"ok":true` 即設定成功

### 第七步：驗證

在瀏覽器開啟以下網址確認 Webhook 正常：

```
https://api.telegram.org/bot{你的TOKEN}/getWebhookInfo
```

回傳結果中 `url` 有值且沒有 `last_error_message` 即成功。

---

## 使用方式

打開 Telegram，找到你建立的 Bot，傳送以下格式：

```
https://www.threads.com/@username/post/xxxxx
職涯 AI工具
33000 928 25 78 662
```

| 行 | 說明 | 必填 |
|----|------|------|
| 第一行 | Threads 連結（可在後面加關鍵字） | 必填 |
| 第二行 | 手動標籤關鍵字 | 選填 |
| 第三行 | 5 個數字：瀏覽 愛心 留言 轉發 分享 | 選填 |

Bot 回覆確認後，資料即寫入 Google Sheet，並由 Claude 自動補上 AI 分析欄位。

---

## 批次補分析舊資料

若有舊資料沒有 AI 分析，可在 Apps Script 選擇 `analyzeAllRows` 函式後點「**執行**」，會自動補齊所有空白的主題標籤、風格分類、AI摘要欄位。

---

## 已知限制

- 其他帳號的數據（瀏覽數、愛心數等）無法自動抓取，需手動輸入
- 文案自動抓取成功率約 70-80%，依 Threads 頁面結構而定
- 影片與圖片張數無法自動判斷，只能識別媒體類型

---

## 如何作為 Claude Code Skill 使用

將 `threads-collector.md` 複製到 `~/.claude/commands/` 目錄，即可在 Claude Code 中使用 `/threads-collector` 呼叫完整設定說明。

---

## License

MIT — 自由使用與修改，歡迎 PR 改進。
