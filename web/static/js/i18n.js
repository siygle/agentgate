(function () {
  "use strict";

  // Lightweight zero-dependency i18n for AgentGate (English & Traditional Chinese).
  // Runs both on host pages (strict CSP: script-src 'self', no inline scripts) and
  // inside the opaque-origin render sandbox (inlined via agentgate:i18n, no storage).

  var STORAGE_KEY = "agentgate-lang";
  var SUPPORTED = ["en", "zh-TW"];

  var MESSAGES = {
    en: {
      // Common
      "lang.label": "Language",
      "lang.en": "English",
      "lang.zhTW": "繁體中文",
      "common.copy": "Copy",
      "common.copied": "Copied",
      "common.copyFailed": "Copy failed",
      "common.failed": "Failed",
      "common.close": "Close",
      "common.cancel": "Cancel",
      "common.open": "Open",
      "common.loading": "Loading…",
      "common.preparing": "Preparing…",
      "common.refresh": "Refresh",
      "common.files": "Files",
      "common.untitled": "untitled",
      "common.backHome": "Back to home",

      // Landing page
      "landing.title": "AgentGate - Encrypted diff & file sharing",
      "landing.agentSetup": "Agent Setup",
      "landing.setupModalTitle": "Agent Setup Instructions",
      "landing.setupModalHint": "Copy and paste to your AI agent to generate a skill for the AgentGate CLI.",
      "landing.eyebrowHero": "Self-hosted · Zero-knowledge",
      "landing.heroTitle": "Share diffs and files your server can't read.",
      "landing.heroLead": "AgentGate encrypts everything in your terminal before it leaves your machine. AES-256-GCM, client-side. The server only ever holds ciphertext — and forgets it after 7 days.",
      "landing.installCli": "Install the CLI",
      "landing.metaBinary": "Single Go binary",
      "landing.metaSqlite": "SQLite storage",
      "landing.metaNoDeps": "No external services",
      "landing.eyebrowWhy": "Why AgentGate",
      "landing.featEncTitle": "End-to-end encrypted",
      "landing.featEncBody": "AES-256-GCM, encrypted in the CLI. Zero-knowledge by design — the server never sees your content or your key.",
      "landing.featExpTitle": "Auto-expiry",
      "landing.featExpBody": "Shared content expires after 7 days by default. Each upload can set a shorter or longer TTL when you need it.",
      "landing.featLiteTitle": "Lightweight",
      "landing.featLiteBody": "One binary, SQLite storage, no external dependencies. Run it with a flag or bring it up with Docker Compose.",
      "landing.eyebrowStart": "Get started",
      "landing.stepsTitle": "From zero to a shared link in four steps",
      "landing.step1": "Run the server",
      "landing.step2": "Install the CLI",
      "landing.step3": "Point it at your server and make a key",
      "landing.step4": "Share anything",
      "landing.footerNote": "Encrypted sharing for code · self-hosted",

      // Share loader & Passphrase dialog
      "share.pageTitle": "Share - AgentGate",
      "share.notFound": "Not found or expired",
      "share.sandboxUnavailable": "Sandbox unavailable — sandbox.js failed to load.",
      "share.renderFailed": "Failed to render: {err}",
      "passphrase.title": "Enter passphrase",
      "passphrase.hint": "This content is encrypted. Enter the passphrase to view it.",
      "passphrase.placeholder": "Passphrase",
      "passphrase.remember": "Remember in this browser",
      "passphrase.decrypt": "Decrypt",
      "passphrase.decrypting": "Decrypting...",
      "passphrase.failed": "Decryption failed. Please check your passphrase.",

      // Share labels
      "kind.artifact": "artifact — {title}",
      "kind.webappOne": "webapp — 1 file",
      "kind.webappMany": "webapp — {n} files",
      "kind.diff": "diff — {title}",
      "kind.visualPlan": "visual plan — {title}",
      "kind.documents": "documents — {title}",
      "kind.filesOne": "1 file",
      "kind.filesMany": "{n} files",

      // Artifact renderer, inspector & diagnostics
      "artifact.resetZoom": "Fit",
      "artifact.bgAuto": "Auto",
      "artifact.bgLight": "Light",
      "artifact.bgDark": "Dark",
      "artifact.bgChecker": "Grid",
      "artifact.runtimeError": "Artifact runtime error",
      "artifact.compileError": "Artifact compile/execution error",
      "artifact.codeBtn": "Code",
      "artifact.codeTitle": "Inspect and live-edit source files",
      "artifact.runReload": "Run / Reload",
      "artifact.resetCode": "Reset",
      "artifact.editedHint": "Local in-memory edits only (not uploaded).",
      "artifact.diagnostics": "Console",
      "artifact.diagnosticsTitle": "Runtime errors and console warnings",
      "artifact.diagEmpty": "No errors or warnings recorded.",
      "artifact.diagClear": "Clear",
      "artifact.diagCopy": "Copy for agent",
      "artifact.aiDisabled": "AI completion is disabled by default in AgentGate (offline sandbox mode — no external network requests are made).",

      // Review state (diff & doc)
      "review.viewed": "Viewed",
      "review.viewedProgress": "{done}/{total} viewed",
      "review.addComment": "Add review comment",
      "review.commentPlaceholder": "Add a review comment…",
      "review.saveComment": "Save",
      "review.deleteComment": "Delete comment",
      "review.title": "Review",
      "review.inlineComments": "Inline comments",
      "review.generalNotes": "General notes",
      "review.noComments": "Click any diff line number or document heading to add an inline comment.",

      // Expiry & Owner controls
      "expiry.expired": "Expired",
      "expiry.hoursRemaining": "{h}h {m}m remaining",
      "expiry.minsRemaining": "{m}m remaining",
      "expiry.expiresAt": "Expires at {time}",
      "expiry.preserved": "Keep forever",
      "expiry.ownerToggle": "Keep forever",
      "expiry.updating": "Updating…",
      "expiry.saved": "Saved",
      "expiry.updateFailed": "Update failed",

      // Display settings panel
      "settings.title": "Display settings",
      "settings.theme": "Theme",
      "settings.themeSystem": "System",
      "settings.themeLight": "Light",
      "settings.themeDark": "Dark",
      "settings.fontSize": "Font Size",
      "settings.sizeSmall": "Small",
      "settings.sizeMedium": "Medium",
      "settings.sizeLarge": "Large",
      "settings.font": "Font",
      "settings.fontSystem": "System",
      "settings.fontHint": "Applies if the font is installed on this device.",

      // Standalone controls & Export
      "standalone.openTitle": "Open in a new tab (standalone, no network access)",
      "standalone.openAria": "Open in a new tab",
      "standalone.popupBlocked": "Popup blocked — allow popups to open standalone",
      "standalone.saveTitle": "Save as a single self-contained .html file",
      "standalone.saveAria": "Save as HTML",
      "export.title": "Export",
      "export.pdf": "PDF",
      "export.pdfAll": "Save as PDF (all files)",
      "export.pdfSingle": "Save as PDF",
      "export.pdfCurrent": "Save as PDF (current file)",
      "export.source": "Source",
      "export.sourceAll": "Download source (all)",
      "export.sourceSingle": "Download source",
      "export.sourceCurrent": "Download current file",

      // Feedback panel
      "feedback.title": "Chat / Feedback",
      "feedback.hint": "Local-only notes for now. Copy them back to your agent after review.",
      "feedback.placeholder": "Leave feedback, questions, or change requests...",
      "feedback.add": "Add",
      "feedback.copyForAgent": "Copy for agent",
      "feedback.copyHeader": "Feedback for {title}",

      // In-frame renderer UI
      "frame.findDoc": "Find in document",
      "frame.findDiff": "Find in diff",
      "frame.findFile": "Find in file",
      "frame.prevMatch": "Previous match",
      "frame.nextMatch": "Next match",
      "frame.noMatches": "no matches",
      "frame.zeroHere": "0 here",
      "frame.otherFileOne": " · 1 other file",
      "frame.otherFiles": " · {n} other files",
      "frame.unresolvedLink": "Link target is not included in this share",
      "frame.renderingMdx": "Rendering MDX…",
      "frame.missingMermaid": "Diagram not rendered — the mermaid library was not loaded for this share.",
      "frame.missingMarkdown": "Preview unavailable — the markdown renderer was not loaded for this share.",
      "frame.sourceTab": "Source",
      "frame.previewTab": "Preview",
      "frame.emptyBundle": "This bundle is empty.",
      "frame.emptyDiff": "This diff is empty — nothing was changed.",
      "frame.diffSplit": "Split",
      "frame.diffUnified": "Unified",
      "frame.diffExpandAll": "Expand All",
      "frame.diffCollapseAll": "Collapse All",
      "frame.diffFileOne": "1 file",
      "frame.diffFiles": "{n} files",
      "frame.wireframe": "Wireframe",

      // Admin dashboard
      "admin.pageTitle": "Owner Dashboard - AgentGate",
      "admin.title": "Owner Dashboard",
      "admin.loginSubtitle": "Sign in to manage all shared resources",
      "admin.disabled": "Admin is not enabled (SESSION_SECRET is not configured).",
      "admin.ownerKeyTab": "Owner Key",
      "admin.ownerKeyPlaceholder": "Owner key",
      "admin.login": "Sign in",
      "admin.loginFailed": "Sign in failed",
      "admin.cfTab": "Cloudflare Access",
      "admin.cfHint": "This deployment is protected by Cloudflare Access. Sign in via Cloudflare and refresh to continue.",
      "admin.noAuthMethods": "No sign-in methods available (neither OWNER_KEY nor Cloudflare Access is configured).",
      "admin.signedInAs": "Signed in · {method}",
      "admin.logout": "Sign out",
      "admin.filterStatus": "Status",
      "admin.filterKind": "Type",
      "admin.all": "All",
      "admin.active": "Active",
      "admin.expired": "Expired",
      "admin.colId": "ID",
      "admin.colKind": "Type",
      "admin.colCreated": "Created",
      "admin.colExpires": "Expires",
      "admin.colStatus": "Status",
      "admin.colStorage": "Storage",
      "admin.colSize": "Size",
      "admin.colActions": "Actions",
      "admin.empty": "No shares found",
      "admin.prevPage": "Previous",
      "admin.nextPage": "Next",
      "admin.pager": "{start}–{end} of {total}",
      "admin.statusForever": "Keep forever 🔒",
      "admin.statusExpired": "Expired",
      "admin.statusActive": "Active",
      "admin.actionUnkeep": "Enable expiry",
      "admin.actionKeep": "Keep forever",
      "admin.actionReshare": "Reshare",
      "admin.actionReset": "Reset key",
      "admin.actionRevoke": "Revoke",
      "admin.actionDelete": "Delete",
      "admin.revokeTitle": "Revoke share",
      "admin.revokeMsg": "This immediately makes the share inaccessible and schedules it for permanent deletion on the next cleanup sweep.",
      "admin.deleteTitle": "Delete permanently",
      "admin.deleteMsg": "This immediately deletes the record and its encrypted payload. This cannot be undone.",
      "admin.reshareTitle": "New share link created",
      "admin.reshareMsg": "The original link is unaffected. The passphrase is unchanged — recipients can open the new link with the same passphrase.",
      "admin.copyManageUrl": "Copy manage link",
      "admin.copyLink": "Copy link",
      "admin.copyPassphrase": "Copy passphrase",
      "admin.resetResultTitle": "Reset & reshared",
      "admin.resetResultMsg": "The old link and old passphrase are now invalid. Deliver the new link and new passphrase separately via a secure channel.",
      "admin.newLink": "New link",
      "admin.newPassphrase": "New passphrase (shown only once)",
      "admin.resetModalTitle": "Reset & Reshare (rotate passphrase)",
      "admin.resetModalHint": "Unwrap the content key locally with your offline recovery private key, assign a brand-new passphrase and link, and revoke the old link. Your private key never leaves the browser.",
      "admin.resetKeyPlaceholder": "Paste recovery private key (base64 from recovery-keygen, or encrypted JSON file contents)",
      "admin.resetKeyPassPlaceholder": "Passphrase protecting the private key (leave blank if unencrypted)",
      "admin.resetBtn": "Reset",
      "admin.resetKeyPassRequired": "This private key file is encrypted — please enter its protecting passphrase.",
      "admin.resetNotCapable": "This share has no recovery key (uploaded before recovery was enabled) and cannot be reset. Use Revoke or Delete instead.",
      "admin.resetFailed": "Reset failed (is the private key correct?)",
      "admin.opFailed": "Action failed",
      "admin.genericError": "An error occurred",
      "admin.loadFailed": "Failed to load",
      "admin.connectFailed": "Unable to connect",
    },

    "zh-TW": {
      // Common
      "lang.label": "語言",
      "lang.en": "English",
      "lang.zhTW": "繁體中文",
      "common.copy": "複製",
      "common.copied": "已複製",
      "common.copyFailed": "複製失敗",
      "common.failed": "失敗",
      "common.close": "關閉",
      "common.cancel": "取消",
      "common.open": "開啟",
      "common.loading": "載入中…",
      "common.preparing": "準備中…",
      "common.refresh": "重新整理",
      "common.files": "檔案",
      "common.untitled": "未命名",
      "common.backHome": "返回首頁",

      // Landing page
      "landing.title": "AgentGate - 端對端加密 Diff 與檔案分享",
      "landing.agentSetup": "Agent 設定",
      "landing.setupModalTitle": "Agent 設定說明",
      "landing.setupModalHint": "複製並貼給你的 AI Agent，即可為 AgentGate CLI 建立對應操作技能。",
      "landing.eyebrowHero": "自託管 · 零知識架構",
      "landing.heroTitle": "分享連伺服器都看不見的 Diff 與檔案。",
      "landing.heroLead": "AgentGate 在資料離開終端機前就完成加密。採用用戶端 AES-256-GCM，伺服器只保存密文，且預設 7 天後自動刪除。",
      "landing.installCli": "安裝 CLI",
      "landing.metaBinary": "單一 Go 執行檔",
      "landing.metaSqlite": "SQLite 儲存",
      "landing.metaNoDeps": "零外部服務依賴",
      "landing.eyebrowWhy": "為什麼選擇 AgentGate",
      "landing.featEncTitle": "端對端加密",
      "landing.featEncBody": "由 CLI 以 AES-256-GCM 加密。從設計上落實零知識原則，伺服器永遠接觸不到明文與金鑰。",
      "landing.featExpTitle": "自動過期",
      "landing.featExpBody": "分享內容預設 7 天後過期，每次上傳皆可依需求自訂更短或更長的保存期限。",
      "landing.featLiteTitle": "輕量免維護",
      "landing.featLiteBody": "單一執行檔搭配 SQLite，沒有外部相依服務。一個指令或 Docker Compose 即可啟動。",
      "landing.eyebrowStart": "快速開始",
      "landing.stepsTitle": "四個步驟，建立加密分享連結",
      "landing.step1": "啟動伺服器",
      "landing.step2": "安裝 CLI",
      "landing.step3": "設定伺服器網址並產生金鑰",
      "landing.step4": "分享任何內容",
      "landing.footerNote": "自託管加密程式碼與文件分享",

      // Share loader & Passphrase dialog
      "share.pageTitle": "分享檢視 - AgentGate",
      "share.notFound": "找不到資源或已過期",
      "share.sandboxUnavailable": "沙盒環境無法使用 — sandbox.js 載入失敗。",
      "share.renderFailed": "渲染失敗：{err}",
      "passphrase.title": "輸入密碼",
      "passphrase.hint": "此內容已加密，請輸入密碼以解密檢視。",
      "passphrase.placeholder": "密碼（Passphrase）",
      "passphrase.remember": "在此瀏覽器記住密碼",
      "passphrase.decrypt": "解密",
      "passphrase.decrypting": "解密中…",
      "passphrase.failed": "解密失敗，請確認密碼是否正確。",

      // Share labels
      "kind.artifact": "互動作品 — {title}",
      "kind.webappOne": "網頁應用 — 1 個檔案",
      "kind.webappMany": "網頁應用 — {n} 個檔案",
      "kind.diff": "差異比較 — {title}",
      "kind.visualPlan": "視覺化計畫 — {title}",
      "kind.documents": "文件 — {title}",
      "kind.filesOne": "1 個檔案",
      "kind.filesMany": "{n} 個檔案",

      // Artifact renderer, inspector & diagnostics
      "artifact.resetZoom": "適應畫面",
      "artifact.bgAuto": "自動",
      "artifact.bgLight": "淺色",
      "artifact.bgDark": "深色",
      "artifact.bgChecker": "網格",
      "artifact.runtimeError": "作品執行期錯誤",
      "artifact.compileError": "作品編譯／執行錯誤",
      "artifact.codeBtn": "程式碼",
      "artifact.codeTitle": "檢視並即時編輯原始碼",
      "artifact.runReload": "執行／重新載入",
      "artifact.resetCode": "重設",
      "artifact.editedHint": "僅在本機記憶體中修改（不會上傳回伺服器）。",
      "artifact.diagnostics": "主控台",
      "artifact.diagnosticsTitle": "執行期錯誤與主控台警告",
      "artifact.diagEmpty": "目前沒有錯誤或警告。",
      "artifact.diagClear": "清除",
      "artifact.diagCopy": "複製給 Agent",
      "artifact.aiDisabled": "AgentGate 預設停用 AI 補全功能（離線沙盒模式 — 不會發出外部網路請求）。",

      // Review state (diff & doc)
      "review.viewed": "已審閱",
      "review.viewedProgress": "已審閱 {done}/{total}",
      "review.addComment": "新增審閱註解",
      "review.commentPlaceholder": "輸入審閱註解…",
      "review.saveComment": "儲存",
      "review.deleteComment": "刪除註解",
      "review.title": "審閱",
      "review.inlineComments": "行內註解",
      "review.generalNotes": "一般回饋",
      "review.noComments": "點擊任意 Diff 行號或文件標題旁的 + 即可新增行內註解。",

      // Expiry & Owner controls
      "expiry.expired": "已過期",
      "expiry.hoursRemaining": "剩餘 {h} 小時 {m} 分鐘",
      "expiry.minsRemaining": "剩餘 {m} 分鐘",
      "expiry.expiresAt": "到期時間：{time}",
      "expiry.preserved": "永久保留",
      "expiry.ownerToggle": "永久保留",
      "expiry.updating": "更新中…",
      "expiry.saved": "已儲存",
      "expiry.updateFailed": "更新失敗",

      // Display settings panel
      "settings.title": "顯示設定",
      "settings.theme": "主題",
      "settings.themeSystem": "系統",
      "settings.themeLight": "淺色",
      "settings.themeDark": "深色",
      "settings.fontSize": "字體大小",
      "settings.sizeSmall": "小",
      "settings.sizeMedium": "中",
      "settings.sizeLarge": "大",
      "settings.font": "字型",
      "settings.fontSystem": "系統",
      "settings.fontHint": "僅在本機已安裝該字型時套用。",

      // Standalone controls & Export
      "standalone.openTitle": "在新分頁開啟（獨立離線檢視，無網路存取）",
      "standalone.openAria": "在新分頁開啟",
      "standalone.popupBlocked": "彈出視窗被阻擋 — 請允許彈出視窗以獨立開啟",
      "standalone.saveTitle": "另存為單一離線 .html 檔案",
      "standalone.saveAria": "另存為 HTML",
      "export.title": "匯出",
      "export.pdf": "PDF",
      "export.pdfAll": "另存為 PDF（全部檔案）",
      "export.pdfSingle": "另存為 PDF",
      "export.pdfCurrent": "另存為 PDF（目前檔案）",
      "export.source": "原始檔",
      "export.sourceAll": "下載原始檔（全部）",
      "export.sourceSingle": "下載原始檔",
      "export.sourceCurrent": "下載目前檔案",

      // Feedback panel
      "feedback.title": "討論 / 回饋筆記",
      "feedback.hint": "僅儲存在本機瀏覽器。審閱完成後可一鍵複製回給你的 Agent。",
      "feedback.placeholder": "留下回饋、問題或修改建議…",
      "feedback.add": "新增",
      "feedback.copyForAgent": "複製給 Agent",
      "feedback.copyHeader": "{title} 的審閱回饋",

      // In-frame renderer UI
      "frame.findDoc": "在文件中搜尋",
      "frame.findDiff": "在差異中搜尋",
      "frame.findFile": "在檔案中搜尋",
      "frame.prevMatch": "上一筆符合",
      "frame.nextMatch": "下一筆符合",
      "frame.noMatches": "無符合項目",
      "frame.zeroHere": "本頁 0 筆",
      "frame.otherFileOne": " · 另有 1 個檔案符合",
      "frame.otherFiles": " · 另有 {n} 個檔案符合",
      "frame.unresolvedLink": "此連結目標未包含在此次分享中",
      "frame.renderingMdx": "正在渲染 MDX…",
      "frame.missingMermaid": "無法渲染圖表 — 此次分享未載入 Mermaid 函式庫。",
      "frame.missingMarkdown": "無法預覽 — 此次分享未載入 Markdown 渲染器。",
      "frame.sourceTab": "原始碼",
      "frame.previewTab": "預覽",
      "frame.emptyBundle": "此分享沒有任何檔案。",
      "frame.emptyDiff": "此 Diff 為空 — 沒有任何變更。",
      "frame.diffSplit": "並排",
      "frame.diffUnified": "合併",
      "frame.diffExpandAll": "全部展開",
      "frame.diffCollapseAll": "全部收合",
      "frame.diffFileOne": "1 個檔案",
      "frame.diffFiles": "{n} 個檔案",
      "frame.wireframe": "線框稿",

      // Admin dashboard
      "admin.pageTitle": "管理後台 - AgentGate",
      "admin.title": "Owner Dashboard",
      "admin.loginSubtitle": "登入以管理所有分享資源",
      "admin.disabled": "管理後台尚未啟用（未設定 SESSION_SECRET）。",
      "admin.ownerKeyTab": "Owner Key",
      "admin.ownerKeyPlaceholder": "輸入 Owner key",
      "admin.login": "登入",
      "admin.loginFailed": "登入失敗",
      "admin.cfTab": "Cloudflare Access",
      "admin.cfHint": "此部署由 Cloudflare Access 保護。透過 Cloudflare 登入後重新整理即可進入。",
      "admin.noAuthMethods": "沒有可用的登入方式（未設定 OWNER_KEY 或 Cloudflare Access）。",
      "admin.signedInAs": "已登入 · {method}",
      "admin.logout": "登出",
      "admin.filterStatus": "狀態",
      "admin.filterKind": "類型",
      "admin.all": "全部",
      "admin.active": "有效",
      "admin.expired": "已過期",
      "admin.colId": "ID",
      "admin.colKind": "類型",
      "admin.colCreated": "建立",
      "admin.colExpires": "到期",
      "admin.colStatus": "狀態",
      "admin.colStorage": "儲存",
      "admin.colSize": "大小",
      "admin.colActions": "操作",
      "admin.empty": "沒有資源",
      "admin.prevPage": "上一頁",
      "admin.nextPage": "下一頁",
      "admin.pager": "{start}–{end} / 共 {total}",
      "admin.statusForever": "永久保留 🔒",
      "admin.statusExpired": "已過期",
      "admin.statusActive": "有效",
      "admin.actionUnkeep": "取消永久",
      "admin.actionKeep": "永久保留",
      "admin.actionReshare": "重新分享",
      "admin.actionReset": "Reset 換金鑰",
      "admin.actionRevoke": "作廢",
      "admin.actionDelete": "刪除",
      "admin.revokeTitle": "作廢分享",
      "admin.revokeMsg": "此動作會立即讓此分享無法存取，並會在下次清理時永久刪除。",
      "admin.deleteTitle": "永久刪除",
      "admin.deleteMsg": "會立即刪除此紀錄與其加密內容，無法復原。",
      "admin.reshareTitle": "已產生新的存取連結",
      "admin.reshareMsg": "舊連結不受影響。密碼不變，收件者用新連結加上原本的密碼即可開啟。",
      "admin.copyManageUrl": "複製管理連結",
      "admin.copyLink": "複製連結",
      "admin.copyPassphrase": "複製密碼",
      "admin.resetResultTitle": "已重設並重新分享",
      "admin.resetResultMsg": "舊連結已作廢、舊密碼失效。請把下列新連結與新密碼分開、透過安全管道交給收件者。",
      "admin.newLink": "新連結",
      "admin.newPassphrase": "新密碼（只顯示這一次）",
      "admin.resetModalTitle": "Reset & 重新分享（換密碼）",
      "admin.resetModalHint": "用離線復原私鑰在本機還原內容金鑰，換上全新密碼產生新連結，並作廢舊連結。私鑰只在瀏覽器使用，不會上傳。",
      "admin.resetKeyPlaceholder": "貼上復原私鑰（recovery-keygen 產生的私鑰；未加密為 base64，或加密後的 JSON 檔內容）",
      "admin.resetKeyPassPlaceholder": "若私鑰有加密保護，輸入其密碼（否則留空）",
      "admin.resetBtn": "重設",
      "admin.resetKeyPassRequired": "此私鑰檔已加密，請輸入保護用密碼。",
      "admin.resetNotCapable": "此分享沒有復原金鑰（在啟用復原前上傳），無法重設。可改用作廢或刪除。",
      "admin.resetFailed": "重設失敗（請確認私鑰是否正確）",
      "admin.opFailed": "操作失敗",
      "admin.genericError": "發生錯誤",
      "admin.loadFailed": "載入失敗",
      "admin.connectFailed": "無法連線",
    },
  };

  function normalizeLocale(raw) {
    if (!raw) return null;
    var s = String(raw).trim().toLowerCase();
    if (s === "zh-tw" || s === "zh_tw" || s.indexOf("zh") === 0) return "zh-TW";
    if (s === "en" || s.indexOf("en-") === 0 || s.indexOf("en_") === 0) return "en";
    return null;
  }

  function detectInitialLocale() {
    try {
      var saved = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
      var norm = normalizeLocale(saved);
      if (norm) return norm;
    } catch (e) {
      // opaque origin or private mode
    }
    try {
      var nav = typeof navigator !== "undefined" && (navigator.language || (navigator.languages && navigator.languages[0]));
      var navNorm = normalizeLocale(nav);
      if (navNorm) return navNorm;
    } catch (e) {
      // ignore
    }
    return "en";
  }

  var currentLocale = detectInitialLocale();
  var listeners = [];

  function t(key, vars) {
    var dict = MESSAGES[currentLocale] || MESSAGES.en;
    var str = Object.prototype.hasOwnProperty.call(dict, key)
      ? dict[key]
      : Object.prototype.hasOwnProperty.call(MESSAGES.en, key)
        ? MESSAGES.en[key]
        : key;
    if (!vars) return str;
    return String(str).replace(/\{(\w+)\}/g, function (whole, name) {
      return Object.prototype.hasOwnProperty.call(vars, name) && vars[name] != null
        ? String(vars[name])
        : whole;
    });
  }

  function applyDom(root) {
    if (typeof document === "undefined") return;
    var scope = root || document;
    if (scope === document && document.documentElement) {
      document.documentElement.setAttribute("lang", currentLocale);
    }
    if (!scope || !scope.querySelectorAll) return;

    Array.prototype.forEach.call(scope.querySelectorAll("[data-i18n]"), function (el) {
      var key = el.getAttribute("data-i18n");
      if (key) el.textContent = t(key);
    });
    Array.prototype.forEach.call(scope.querySelectorAll("[data-i18n-placeholder]"), function (el) {
      var key = el.getAttribute("data-i18n-placeholder");
      if (key) el.setAttribute("placeholder", t(key));
    });
    Array.prototype.forEach.call(scope.querySelectorAll("[data-i18n-title]"), function (el) {
      var key = el.getAttribute("data-i18n-title");
      if (key) el.setAttribute("title", t(key));
    });
    Array.prototype.forEach.call(scope.querySelectorAll("[data-i18n-aria-label]"), function (el) {
      var key = el.getAttribute("data-i18n-aria-label");
      if (key) el.setAttribute("aria-label", t(key));
    });
  }

  function setLocale(next, opts) {
    opts = opts || {};
    var norm = normalizeLocale(next);
    if (!norm) return currentLocale;
    var changed = norm !== currentLocale;
    currentLocale = norm;
    if (opts.persist !== false) {
      try {
        if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, currentLocale);
      } catch (e) {
        // opaque origin or private mode
      }
    }
    applyDom(document);
    if (changed) {
      listeners.slice().forEach(function (fn) {
        try {
          fn(currentLocale);
        } catch (e) {
          console.error("i18n listener failed", e);
        }
      });
    }
    return currentLocale;
  }

  function onChange(fn) {
    if (typeof fn !== "function") return function () {};
    listeners.push(fn);
    return function () {
      var idx = listeners.indexOf(fn);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  }

  // createSwitcher builds a compact EN / 繁中 segmented control that stays synced
  // with global locale changes.
  function createSwitcher(opts) {
    opts = opts || {};
    var wrap = document.createElement("div");
    wrap.className = "lang-switcher" + (opts.className ? " " + opts.className : "");
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", t("lang.label"));

    var buttons = [
      { locale: "en", label: "EN" },
      { locale: "zh-TW", label: "繁中" },
    ].map(function (item) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lang-switcher-btn";
      btn.textContent = item.label;
      btn.setAttribute("data-lang-option", item.locale);
      btn.addEventListener("click", function () {
        setLocale(item.locale);
      });
      wrap.appendChild(btn);
      return { locale: item.locale, btn: btn };
    });

    function sync() {
      wrap.setAttribute("aria-label", t("lang.label"));
      buttons.forEach(function (item) {
        var active = item.locale === currentLocale;
        item.btn.classList.toggle("active", active);
        item.btn.setAttribute("aria-pressed", active ? "true" : "false");
      });
    }

    sync();
    onChange(sync);
    return wrap;
  }

  window.AgentGateI18n = {
    locales: SUPPORTED,
    messages: MESSAGES,
    normalizeLocale: normalizeLocale,
    getLocale: function () {
      return currentLocale;
    },
    setLocale: setLocale,
    t: t,
    applyDom: applyDom,
    onChange: onChange,
    createSwitcher: createSwitcher,
  };
})();
