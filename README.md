# Threads 收藏機器人 v5

用 Telegram Bot 收藏 Threads 貼文，自動透過 Apify 抓取內容、Claude AI 分析標籤與摘要，寫入 Google Sheet。

**架構：Telegram Bot → Google Apps Script（輪詢）→ Apify → Claude → Google Sheet**

> ⚠️ v5 已棄用 Webhook，改為 Time-based Trigger 輪詢，解決 Google Apps Script 的 302 轉址問題。

---

## 功能

- 傳 Threads 連結給 Bot → 自動存入 Google Sheet
- Apify 抓取貼文文案、瀏覽、愛心、留言、轉發數據
- Claude AI 分析主題標籤、內容風格、一句話摘要
- 支援手動補標籤、手動輸入數字
- 抓不到文案時，傳「重試」可重新抓取
- 每 1～5 分鐘自動輪詢一次

---

## Sheet 欄位順序

| 欄位 | 說明 |
|------|------|
| 時間 | 存入時間 |
| 連結 | Threads URL |
| 帳號 | @username |
| 手動標籤 | 自己填的標籤 |
| 文案 | 貼文內容（Apify 抓取）|
| 媒體類型 | 圖片/影片/純文字 |
| 瀏覽 | 瀏覽數 |
| 愛心 | 愛心數 |
| 留言 | 留言數 |
| 轉發 | 轉發數 |
| 分享 | 引用數 |
| 主題標籤 | Claude 分析 |
| 風格分類 | Claude 分析 |
| AI摘要 | Claude 分析 |

---

## 需要的 API

| 服務 | 用途 | 取得方式 |
|------|------|----------|
| Telegram Bot Token | 接收訊息 | [@BotFather](https://t.me/BotFather) |
| Claude API Key | AI 分析 | [console.anthropic.com](https://console.anthropic.com) |
| Apify Token | 抓取 Threads 內容 | [apify.com](https://apify.com) |

---

## 安裝步驟

### 1. 建立 Google Apps Script 專案

前往 [script.google.com](https://script.google.com)，新增專案，將 `code.gs` 全部貼入。

### 2. 初始化 Config 工作表

執行：
```
initConfigSheet()
```

### 3. 填入 Config 設定值

在 Google Sheet 的 `Config` 工作表填入：

| KEY | VALUE |
|-----|-------|
| TG_TOKEN | Telegram Bot Token |
| CLAUDE_API_KEY | Claude API Key |
| APIFY_TOKEN | Apify Token |
| ADMIN_CHAT_ID | 你的 Telegram Chat ID（用 getMyChatId() 取得）|
| SHEET_ID | Google Sheet ID（可空白，空白則用當前試算表）|
| DATA_SHEET_NAME | Threads收藏 |
| ANALYSIS_LANGUAGE | 繁體中文 |
| CLAUDE_MODEL | claude-haiku-4-5-20251001 |

### 4. 測試各項功能

依序執行：

```
testSendMessage()   → Bot 是否能傳訊息
testApify()         → Apify 是否能抓資料
testClaude()        → Claude 是否能分析
```

### 5. 執行一次主流程

```
pollTelegramAndProcess()
```

確認正常後，建立自動觸發器：

```
createPollingTriggerEvery1Min()   // 每 1 分鐘
// 或
createPollingTriggerEvery5Min()   // 每 5 分鐘
```

---

## 使用方式

### 傳送格式

**只傳連結：**
```
https://www.threads.net/@username/post/xxxxx
```

**連結 + 手動標籤：**
```
https://www.threads.net/@username/post/xxxxx
行銷,社群,KOL
```

**連結 + 手動數字（瀏覽 愛心 留言 轉發 分享）：**
```
https://www.threads.net/@username/post/xxxxx
12000 890 45 23 10
```

**連結 + 標籤 + 數字：**
```
https://www.threads.net/@username/post/xxxxx
行銷,社群
12000 890 45 23 10
```

### 特殊指令

| 指令 | 功能 |
|------|------|
| `重試` 或 `retry` | 重新抓取最近一筆空白文案 |

---

## 函式說明

| 函式 | 說明 |
|------|------|
| `pollTelegramAndProcess()` | 主流程，輪詢並處理新訊息 |
| `initConfigSheet()` | 初始化 Config 工作表 |
| `testSendMessage()` | 測試 Telegram 傳訊 |
| `testApify()` | 測試 Apify 抓取 |
| `testClaude()` | 測試 Claude 分析 |
| `getMyChatId()` | 取得自己的 Chat ID |
| `analyzeAllRows()` | 批次補分析所有空白 AI 欄位 |
| `retryLastEmptyCaptionRow()` | 重試最近一筆空白文案 |
| `retryEmptyCaptionsBatch()` | 批次補齊所有空白文案 |
| `createPollingTriggerEvery1Min()` | 建立每 1 分鐘觸發器 |
| `createPollingTriggerEvery5Min()` | 建立每 5 分鐘觸發器 |
| `createRetryTrigger()` | 建立每 10 分鐘自動補齊觸發器 |
| `deleteWebhookNow()` | 刪除舊 Webhook（如果有設過）|
| `deleteAllProjectTriggers()` | 刪除所有觸發器 |
| `dailyHealthCheck()` | 每日健康通知 |

---

## 常見問題

**Q: 文案抓不到怎麼辦？**  
傳「重試」給 Bot，會自動重抓最近一筆空白文案。或執行 `retryEmptyCaptionsBatch()` 批次補齊。

**Q: 為什麼用輪詢而不用 Webhook？**  
Google Apps Script 的 Web App 在外部呼叫時會返回 302 轉址，Telegram Webhook 不接受，導致永遠無法正常觸發。改用輪詢（Time-based Trigger）可完全避開這個問題。

**Q: 觸發器最快多久一次？**  
Google Apps Script 最快支援每 1 分鐘觸發一次。

**Q: Apify 用哪個 Actor？**  
`7xFgGDhba8W5ZvOke`（Threads Scraper）。

---

## 版本紀錄

| 版本 | 說明 |
|------|------|
| v5 | 改為輪詢架構，棄用 Webhook，新增重試指令、批次補齊機制 |
| v4 | Webhook 版，修正 Config key 名稱、強化錯誤處理 |
| v3 | 初始 Webhook 版本 |
