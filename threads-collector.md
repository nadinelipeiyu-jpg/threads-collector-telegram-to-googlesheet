# Threads 內容收藏系統 v3 (Telegram Bot → Google Sheet + AI 分析)

## 系統說明

從 Threads 看到好文 → 傳連結給 Telegram Bot → 自動存入 Google Sheet + Claude AI 分析

## 架構

```
iPhone Telegram App
    ↓ 傳連結（可附標籤和數據）
Telegram Bot
    ↓ Webhook
Google Apps Script（免費雲端）
    ↓ Apify 自動抓取文案 + 互動數
    ↓ Claude API AI 分析
Google Sheet（14欄）
```

## Google Sheet 欄位結構

| 欄 | 名稱 | 來源 |
|----|------|------|
| A | 時間 | 自動 |
| B | 連結 | 自動（去除追蹤參數） |
| C | 帳號 | 自動（從URL解析） |
| D | 文案 | Apify 自動抓取 |
| E | 媒體類型 | Apify 自動（圖片/影片/純文字） |
| F | 瀏覽數 | 手動輸入 |
| G | 愛心數 | Apify 自動抓取 |
| H | 留言數 | Apify 自動抓取 |
| I | 轉發數 | 手動輸入 |
| J | 分享數 | 手動輸入 |
| K | 主題標籤 | Claude AI 自動分析 |
| L | 風格分類 | Claude AI 自動分析 |
| M | AI摘要 | Claude AI 自動分析 |
| N | 手動標籤 | 使用者輸入 |

## Telegram Bot 輸入格式

```
https://www.threads.com/@username/post/xxxxx   ← 必填
職涯 AI工具                                      ← 選填：手動標籤
78 662                                          ← 選填：轉發數 分享數
```

- 愛心數和留言數由 Apify 自動抓取
- 第二行是手動標籤（任何文字）
- 第三行是 2 個數字（轉發、分享），選填

## ⚙️設定分頁 Key 列表

| Key | 說明 |
|-----|------|
| TELEGRAM_TOKEN | 從 @BotFather 取得 |
| CLAUDE_API_KEY | 從 console.anthropic.com 取得 |
| APIFY_TOKEN | 從 apify.com → Settings → API 取得 |
| WEBAPP_URL | 部署後取得的 Apps Script 網址 |
| ADMIN_CHAT_ID | 你的 Telegram Chat ID（健康檢查用） |
| DATA_SHEET_NAME | 資料分頁名稱（預設：📊資料） |
| ANALYSIS_LANGUAGE | AI分析語言（預設：繁體中文） |

## 設定步驟（簡易版）

1. Telegram → @BotFather → `/newbot` → 取得 Token
2. 建立 Google Sheet
3. 取得 Claude API Key（console.anthropic.com）
4. 取得 Apify Token（apify.com → Settings）
5. Apps Script → 貼入 code.gs → 執行 `initSetupSheet()`
6. 填入 ⚙️設定 分頁的各項 Key
7. 部署為網頁應用程式 → 複製網址填入 WEBAPP_URL
8. 執行 `setWebhook()`
9. 對 Bot 發訊息 → 執行 `getMyCharId()` → 填入 ADMIN_CHAT_ID
10. 設定定時觸發器 → `dailyHealthCheck` → 每天早上9點

## 可手動執行的函式

| 函式 | 用途 |
|------|------|
| `initSetupSheet()` | 第一次建立設定分頁 |
| `setWebhook()` | 設定 Telegram Webhook |
| `getMyCharId()` | 取得你的 Chat ID |
| `testApify()` | 測試 Apify 是否正常連線 |
| `analyzeAllRows()` | 批次補分析舊資料 |
| `dailyHealthCheck()` | 手動測試健康檢查通知 |

## Apify 費用參考

- 每次抓取約 $0.01–$0.03
- 50篇/天 × 30天 ≈ $30/月
- 建議方案：Starter $29/月（含 $29 credits）

## 已知限制

- 轉發數和分享數無法自動抓取
- 圖片/影片張數無法精確判斷
