# CanIAgent contributor instructions

- Keep the compatibility database evidence-first. Never turn an unverified assumption into `yes` or `no`.
- Prefer official documentation and first-party source code. Add a `checked` date for every evidence item.
- Run `npm run check` before committing JavaScript or matrix changes.
- When `data/matrix.json` changes, run `npm run site:data` and commit the matching `docs/matrix.json`.
- The CLI intentionally uses only Node.js built-ins. Avoid runtime dependencies unless the benefit is substantial.
- Preserve Node.js 20 compatibility.
- Unknown is a valid status and is preferable to guessing.

## Google Drive — Repository-specific Build Delivery (Required)

所有 Codex／Agent／人工開發者均必須遵守。Google Drive 正式交付位置：`AI Project/caniagent/`（AI Project 根資料夾 ID：`1Yhfro6Ss5TSCXCVIZIHEu5h7V1gL8b27`），資料夾名稱必須**完全等於 GitHub Repository 名稱**。

1. **最新完整版放專案資料夾根目錄**：只有 Build 已成功、經可執行／必要測試、檔案完整（ZIP、SHA-256、分割檔所有片段、必要安裝／還原腳本）且 Drive 讀回確認後，才作為最新版；不要為每次 Build 建立新的版本資料夾，更不能散放於 `AI Project/` 根目錄。
2. **重大差異才建立版本子資料夾**：例如重要功能、架構、平台相容性或美術里程碑，用 `vX.Y.Z-功能名稱/` 封存重要版本；一般舊 Build 移到 `歷史封存/`，不刪除、不遺失必要還原檔。已存在的其它檔案與 Git 專案不可動。
3. **新版上傳必須先驗證再換版**：核對 ZIP、checksum、大小、版本、所有分片，並讀回 Drive parent／名稱。缺少 ZIP 或只有 checksum 的版本是**不完整**，不可取代上一個完整最新版；失敗時保留舊版並清楚回報。
4. **各平台最新版可並存**：Windows／Linux／Google TV 等各保留其完整最新交付；同一版本的 checksum 和啟動說明要放一起。沒產出實際 Build 就不假稱上傳成功，也不必建立空資料夾。
5. **每次開發均推送 GitHub**。昂貴 Build／發布 GitHub Actions 只在有必要的手動 `workflow_dispatch` 或正式 `release: published` 觸發，不要每次 push `main` 都重建／重傳。最終回報專案資料夾連結、Build 版本、檔案、SHA 與驗證狀態。

**For all coding agents:** The current verified build belongs directly in `AI Project/caniagent/`; create `vX.Y.Z-description/` only for material historical milestones; place routine older builds in `歷史封存/`; never publish an incomplete upload as latest. This policy applies to every future build.
