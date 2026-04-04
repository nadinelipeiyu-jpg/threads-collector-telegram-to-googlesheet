# Threads Collector v3

用 Telegram Bot 收藏 Threads 好文，自動存入 Google Sheet，並由 Claude AI 自動分析分類。

---

## 功能

- 傳 Threads 連結給 Bot → 自動存入 Google Sheet
- **Apify 自動抓取**：文案、來源帳號、媒體類型、愛心數、留言數
- Claude AI 自動分析：主題標籤、風格分類、AI摘要
- 支援手動附加關鍵字和轉發/分享數據
- **設定頁架構**：改 Token/Key 只需改 Google Sheet，不需動程式碼
- **每日健康檢查**：Bot 掛掉時自動通知

---

## 系統架構

```
iPhone Telegram App
    ↓ 傳連結（可附關鍵字和數據）
Telegram Bot
    ↓ Webhook
Google Apps Script（免費雲端）
    ↓ 呼叫 Apify 抓取文案 + 互動數
    ↓ 呼叫 Claude API 分析
Google Sheet（14欄）
```

---

## 準備事項

| 項目 | 說明 | 費用 |
|------|------|------|
| Telegram 帳號 | 傳訊息的介面 | 免費 |
| Google 帳號 | Google Sheet + Apps Script | 免費 |
| Claude API Key | AI 分析用 | 有免費額度 |
| Apify Token | 自動抓取 Threads 文案 | 免費額度每月 $5 |

---

## Google Sheet 欄位

| 欄 | 名稱 | 來源 |
|----|------|------|
| A | 時間 | 自動 |
| B | 連結 | 自動（已去除追蹤參數） |
| C | 帳號 | 自動（從 URL 解析） |
| D | 文案 | Apify 自動抓取 |
| E | 媒體類型 | Apify 自動（圖片/影片/純文字） |
| F | 瀏覽數 | 手動輸入 |
| G | 愛心數 | Apify 自動抓取 |
| H | 留言數 | Apify 自動抓取 |
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
2. 不需要手動建立欄位，第一次存入資料時會自動建立

### 第三步：取得 Claude API Key

1. 前往 [console.anthropic.com](https://console.anthropic.com)
2. 點選左側 **API Keys** → **Create Key**
3. 複製 `sk-ant-` 開頭的 Key

### 第四步：取得 Apify Token

1. 前往 [apify.com](https://apify.com) 註冊帳號
2. 左側選單 → **Settings** → **API & Integrations**
3. 複製 **Personal API token**

### 第五步：建立 Google Apps Script

1. 在 Google Sheet 點選上方選單「**擴充功能**」→「**Apps Script**」
2. 刪除預設程式碼，貼入 `code.gs` 的完整內容
3. 存檔（Cmd+S）

### 第六步：初始化設定頁

1. 選擇 `initSetupSheet` 函式後點「**執行**」
2. 會自動建立「⚙️設定」分頁
3. 填入以下設定：

| Key | Value |
|-----|-------|
| TELEGRAM_TOKEN | 從 @BotFather 取得的 Token |
| CLAUDE_API_KEY | 從 Anthropic 取得的 Key |
| APIFY_TOKEN | 從 Apify 取得的 Token |
| WEBAPP_URL | 部署後取得的網址（第七步填） |
| ADMIN_CHAT_ID | 你的 Telegram Chat ID（第八步填） |
| DATA_SHEET_NAME | 📊資料（預設，可自訂） |
| ANALYSIS_LANGUAGE | 繁體中文（預設，可自訂） |

### 第七步：部署為網頁應用程式

1. 點選右上角「**部署**」→「**新增部署作業**」
2. 點選齒輪圖示，選擇「**網頁應用程式**」
3. 設定：
   - 執行身分：**我**
   - 誰可以存取：**所有人**
4. 點選「**部署**」，完成 Google 授權流程
5. 複製產生的網址（格式：`https://script.google.com/macros/s/xxx/exec`）
6. 貼入「⚙️設定」分頁的 `WEBAPP_URL` 欄位

### 第八步：設定 Webhook

1. 回到 Apps Script 編輯器
2. 選擇 `setWebhook` 函式後點「**執行**」
3. 下方 Log 出現 `"ok":true` 即設定成功

### 第九步：取得 ADMIN_CHAT_ID（健康檢查用）

1. 對你的 Bot 發送任意訊息
2. 在 Apps Script 選擇 `getMyCharId` 函式後點「**執行**」
3. 在 Log 找到 `"id": 數字`，複製那個數字
4. 填入「⚙️設定」分頁的 `ADMIN_CHAT_ID` 欄位

### 第十步：設定每日健康檢查

1. Apps Script 左側點「**觸發條件**」（時鐘圖示）
2. 右下角「**新增觸發條件**」
3. 函式選 `dailyHealthCheck`，時間選每天早上 9 點
4. 儲存

---

## 使用方式

打開 Telegram，找到你建立的 Bot，傳送以下格式：

```
https://www.threads.com/@username/post/xxxxx
職涯 AI工具
78 662
```

| 行 | 說明 | 必填 |
|----|------|------|
| 第一行 | Threads 連結 | 必填 |
| 第二行 | 手動標籤關鍵字 | 選填 |
| 第三行 | 2 個數字：轉發 分享 | 選填 |

愛心數和留言數由 Apify 自動抓取，不需手動輸入。

---

## 測試 Apify 連線

若 Bot 無法抓取文案，在 Apps Script 執行 `testApify()` 函式，查看 Log 確認 Apify 是否正常運作。

---

## 批次補分析舊資料

若有舊資料沒有 AI 分析，在 Apps Script 選擇 `analyzeAllRows` 函式後點「**執行**」，會自動補齊所有空白的主題標籤、風格分類、AI摘要欄位。

---

## 已知限制

- 轉發數和分享數無法自動抓取，需手動輸入
- 圖片/影片張數無法精確判斷，只能識別有無媒體
- 文案抓取依賴 Apify，若 Apify 額度用盡會暫停自動抓取

---

## 更新設定不需重新部署

改 Token / API Key / 任何設定：只需修改 Google Sheet 的「⚙️設定」分頁，**不需要重新部署**。

---

## 如何作為 Claude Code Skill 使用

將 `threads-collector.md` 複製到 `~/.claude/commands/` 目錄，即可在 Claude Code 中使用 `/threads-collector` 呼叫完整設定說明。

---

## License

MIT — 自由使用與修改，歡迎 PR 改進。
