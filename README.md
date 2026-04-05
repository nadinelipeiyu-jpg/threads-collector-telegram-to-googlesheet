# Threads 收藏機器人 vFinal

用 Telegram Bot 收藏 Threads 貼文，自動透過 Apify 抓取內容、Claude AI 分析標籤與摘要，寫入 Google Sheet。

**架構：Telegram Bot → Google Apps Script（輪詢）→ Apify → Claude → Google Sheet**

> ⚠️ 已棄用 Webhook，改為 Time-based Trigger 輪詢，解決 Google Apps Script 的 302 轉址問題。

---

## 功能

- 傳 Threads 連結給 Bot → 自動存入 Google Sheet
- Apify 抓取貼文文案、瀏覽、愛心、留言、轉發數據
- Claude AI 分析主題標籤、內容風格、一句話摘要
- **防重複**：同一篇連結第二次傳會直接回「已存過」
- **自動補抓**：文案暫時抓不到會標記待補抓，每 30 分鐘自動重試
- **重試限制**：最多重試 3 次，每次間隔至少 20 分鐘，避免濫用 API
- 支援手動補標籤、手動輸入數字
- 可手動重抓指定列

---

## Sheet 欄位順序

| # | 欄位 | 說明 |
|---|------|------|
| 1 | 時間 | 存入時間 |
| 2 | 連結 | Threads URL |
| 3 | 帳號 | @username |
| 4 | 手動標籤 | 自己填的標籤 |
| 5 | 文案 | 貼文內容（Apify 抓取）|
| 6 | 媒體類型 | 圖片/影片/純文字 |
| 7 | 瀏覽 | 瀏覽數 |
| 8 | 愛心 | 愛心數 |
| 9 | 留言 | 留言數 |
| 10 | 轉發 | 轉發數 |
| 11 | 分享 | 引用數 |
| 12 | 主題標籤 | Claude 分析 |
| 13 | 風格分類 | Claude 分析 |
| 14 | AI摘要 | Claude 分析 |
| 15 | 抓取狀態 | `completed` / `pending_retry` / `failed` |
| 16 | 重試次數 | 自動補抓已嘗試次數 |
| 17 | 最後重試時間 | 上次補抓時間 |
| 18 | 備註 | 狀態說明 |

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

| KEY | VALUE |
|-----|-------|
| TG_TOKEN | Telegram Bot Token |
| CLAUDE_API_KEY | Claude API Key |
| APIFY_TOKEN | Apify Token |
| ADMIN_CHAT_ID | 你的 Telegram Chat ID（用 `getMyChatId()` 取得）|
| SHEET_ID | Google Sheet ID（可空白，空白則用當前試算表）|
| DATA_SHEET_NAME | Threads收藏 |
| ANALYSIS_LANGUAGE | 繁體中文 |
| CLAUDE_MODEL | `claude-haiku-4-5-20251001`（完整版本）或 `claude-haiku-4-5`（alias，自動跟版）|
| MAX_RETRY | 3（最多補抓次數）|
| MIN_RETRY_GAP_MINUTES | 20（兩次補抓最小間隔分鐘）|

### 4. 測試各項功能

```
testSendMessage()   → Bot 是否能傳訊息
testApify()         → Apify 是否能抓資料
testClaude()        → Claude 是否能分析
```

### 5. 手動執行一次確認正常

```
pollTelegramAndProcess()
```

### 6. 建立自動觸發器

```
createPollingTriggerEvery1Min()    // 每 1 分鐘輪詢一次
createRetryTriggerEvery30Min()     // 每 30 分鐘自動補抓
createDailyHealthCheckTrigger()    // 每日健康通知（選用）
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

---

## 函式說明

| 函式 | 說明 |
|------|------|
| `pollTelegramAndProcess()` | 主流程，輪詢並處理新訊息 |
| `retryPendingThreadsRows()` | 自動補抓所有 pending_retry 的列 |
| `retryRowByNumber(列號)` | 手動重抓指定列（列號從 2 開始）|
| `initConfigSheet()` | 初始化 Config 工作表 |
| `testSendMessage()` | 測試 Telegram 傳訊 |
| `testApify()` | 測試 Apify 抓取 |
| `testClaude()` | 測試 Claude 分析 |
| `getMyChatId()` | 取得自己的 Chat ID |
| `analyzeAllRows()` | 批次補分析所有空白 AI 欄位 |
| `createPollingTriggerEvery1Min()` | 建立每 1 分鐘輪詢觸發器 |
| `createPollingTriggerEvery5Min()` | 建立每 5 分鐘輪詢觸發器 |
| `createRetryTriggerEvery30Min()` | 建立每 30 分鐘補抓觸發器 |
| `createDailyHealthCheckTrigger()` | 建立每日健康通知觸發器 |
| `deleteWebhookNow()` | 刪除舊 Webhook（如果有設過）|
| `deleteAllProjectTriggers()` | 刪除所有觸發器 |
| `dailyHealthCheck()` | 每日健康通知 |

---

## 抓取狀態說明

| 狀態 | 說明 |
|------|------|
| `completed` | 文案抓取成功，AI 分析完成 |
| `pending_retry` | 文案暫時抓不到，等待自動補抓 |
| `failed` | 已達重試上限（MAX_RETRY），不再自動補抓 |

---

## 常見問題

**Q: 文案抓不到怎麼辦？**  
系統會自動標記為 `pending_retry`，每 30 分鐘自動重試，最多 3 次。也可執行 `retryRowByNumber(列號)` 手動重抓。

**Q: 為什麼用輪詢而不用 Webhook？**  
Google Apps Script 的 Web App 在外部呼叫時會返回 302 轉址，Telegram Webhook 不接受，導致永遠無法正常觸發。改用輪詢（Time-based Trigger）可完全避開這個問題。

**Q: CLAUDE_MODEL 要填什麼？**  
兩個都可以用：
- `claude-haiku-4-5-20251001`：固定版本，行為穩定不變（建議）
- `claude-haiku-4-5`：alias，自動指向最新 Haiku 4.5

**Q: 觸發器最快多久一次？**  
Google Apps Script 最快支援每 1 分鐘觸發一次。

**Q: Apify 用哪個 Actor？**  
`7xFgGDhba8W5ZvOke`（Threads Scraper）。

---

## 版本紀錄

| 版本 | 說明 |
|------|------|
| vFinal | 新增防重複、自動補抓佇列（pending_retry）、重試次數與間隔限制、手動重抓指定列 |
| v5 | 改為輪詢架構，棄用 Webhook，新增重試指令、批次補齊機制 |
| v4 | Webhook 版，修正 Config key 名稱、強化錯誤處理 |
| v3 | 初始 Webhook 版本 |
